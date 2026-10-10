import SafariServices
import UIKit
import WebKit

/// The whole app: one full-screen WKWebView on https://qubit16.ai, plus the
/// native behaviour a web view does not give you for free and that App Review
/// and real users both notice:
///
///  - edge-swipe back/forward, pull-to-refresh, a load progress bar
///  - a branded offline screen instead of a blank view or an error
///  - external links (Stripe checkout, mailto, other sites) leave the app
///    shell instead of navigating the product's own web view away from the product
///  - file exports (certificates, OpenQASM) via WKDownload and the share sheet
///  - JavaScript alert/confirm/prompt, which a bare WKWebView silently drops
///  - recovery when iOS kills the web content process under memory pressure
///
/// There is deliberately no product logic here. See docs/IOS.md.
final class WebViewController: UIViewController {
    private let startURL: URL
    private var webView: WKWebView!
    private let progressBar = UIProgressView(progressViewStyle: .bar)
    private let refreshControl = UIRefreshControl()
    private var progressObservation: NSKeyValueObservation?
    private var lastRequestedURL: URL?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    init(startURL: URL?) {
        self.startURL = startURL ?? AppConfig.startURL
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = AppConfig.background

        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = AppConfig.userAgentToken
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        // Required for the site's service worker (its offline mode, public/sw.js)
        // to run inside a web view at all: WebKit only enables service workers
        // for domains the app declares in WKAppBoundDomains (project.yml). The
        // flip side is that this view can only navigate to those domains, which
        // is why every other host is handed to Safari in decidePolicyFor.
        config.limitsNavigationsToAppBoundDomains = true
        // The offline page's "Try again" button posts here. The weak wrapper stops
        // the user-content controller retaining this controller (a retain cycle
        // that would keep the web view alive after the scene is gone).
        config.userContentController.add(WeakScriptHandler(self), name: "retry")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // The page handles the notch and home indicator itself with
        // env(safe-area-inset-*) (viewport-fit=cover, apps/web/app/layout.tsx).
        // Letting UIKit inset the scroll view as well would count them twice.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        // Pinned to the view's edges, NOT the safe-area guide: the page draws
        // under the status bar and home indicator on purpose.
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        self.webView = webView

        refreshControl.tintColor = AppConfig.accent
        refreshControl.addTarget(self, action: #selector(pulledToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        progressBar.progressTintColor = AppConfig.accent
        progressBar.trackTintColor = .clear
        progressBar.translatesAutoresizingMaskIntoConstraints = false
        progressBar.alpha = 0
        view.addSubview(progressBar)
        NSLayoutConstraint.activate([
            progressBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progressBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in
            self?.showProgress(web.estimatedProgress)
        }

        load(startURL)
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "retry")
    }

    // MARK: - Loading

    /// Open a URL that arrived from a Universal Link or a quick action. Refuses
    /// anything off the app's own hosts.
    func open(_ url: URL) {
        guard AppConfig.isAppHost(url) else { return }
        loadViewIfNeeded()
        load(url)
    }

    private func load(_ url: URL) {
        lastRequestedURL = url
        webView.load(URLRequest(url: url))
    }

    @objc private func pulledToRefresh() {
        if webView.url == nil || webView.url?.scheme == "about" {
            // Showing the offline page: "refresh" means retry the real page.
            load(lastRequestedURL ?? startURL)
        } else {
            webView.reload()
        }
    }

    private func showProgress(_ value: Double) {
        let complete = value >= 1.0
        progressBar.setProgress(Float(value), animated: !complete)
        UIView.animate(withDuration: 0.25, delay: complete ? 0.2 : 0) {
            self.progressBar.alpha = complete ? 0 : 1
        }
    }

    /// A branded page for "no connection", loaded in place of the failed one.
    private func showOffline() {
        guard let url = Bundle.main.url(forResource: "offline", withExtension: "html"),
              let html = try? String(contentsOf: url, encoding: .utf8) else {
            return
        }
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - Presenting

    private var topViewController: UIViewController {
        var top: UIViewController = self
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    private func presentSafari(_ url: URL) {
        // SFSafariViewController throws on anything but http(s).
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            UIApplication.shared.open(url)
            return
        }
        let safari = SFSafariViewController(url: url)
        safari.preferredControlTintColor = AppConfig.accent
        topViewController.present(safari, animated: true)
    }

    private func share(file: URL) {
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            // iPad requires an anchor; the centre with no arrow reads as a sheet.
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        topViewController.present(sheet, animated: true)
    }
}

// MARK: - Navigation

extension WebViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        switch url.scheme?.lowercased() {
        case "http", "https":
            if AppConfig.isAppHost(url) {
                decisionHandler(.allow)
            } else if navigationAction.targetFrame?.isMainFrame == false {
                // An embedded frame (a video, a widget) loading its own content.
                decisionHandler(.allow)
            } else {
                // The main page is leaving the product — Stripe checkout, a
                // reference link. Do it in a Safari sheet over the app so the
                // product's own web view is never navigated away, and closing the
                // sheet lands the user exactly where they were.
                presentSafari(url)
                decisionHandler(.cancel)
            }
        case "about", "blob", "data":
            decisionHandler(.allow)
        case "mailto", "tel", "sms":
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        default:
            // Any other scheme (itms-apps://, maps://, another app's) is a
            // hand-off to the system, never something to load here.
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        if disposition.hasPrefix("attachment") || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    private func handle(_ error: Error) {
        refreshControl.endRefreshing()
        let nsError = error as NSError

        // Cancellations are not failures: a tap that supersedes a load, a link
        // handed to Safari (WebKitErrorFrameLoadInterruptedByPolicyChange, 102),
        // a download taking over the navigation.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }

        if let failed = nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL {
            lastRequestedURL = failed
        }
        showOffline()
    }

    /// iOS reclaims the web content process under memory pressure — easy to hit
    /// with a WebGL visualization open. Left alone the view goes permanently
    /// blank; reloading brings the page back.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView.url == nil {
            load(lastRequestedURL ?? startURL)
        } else {
            webView.reload()
        }
    }
}

// MARK: - Window and dialogs

extension WebViewController: WKUIDelegate {
    /// `target="_blank"` and `window.open`. Our own pages stay in this view;
    /// anything else goes to Safari.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if AppConfig.isAppHost(url) {
            load(url)
        } else {
            presentSafari(url)
        }
        return nil
    }

    // A bare WKWebView ignores these, and the page then behaves as if the user
    // dismissed every confirm() — the site uses them for "reset progress".

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        topViewController.present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        topViewController.present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        topViewController.present(alert, animated: true)
    }
}

// MARK: - Downloads

extension WebViewController: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        // A fresh directory per download so two files with the same name (two
        // certificates) can never collide, and nothing outlives the temp folder.
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("downloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        // Strip any path the server suggested; keep only the file name.
        let name = (suggestedFilename as NSString).lastPathComponent
        let destination = dir.appendingPathComponent(name.isEmpty ? "download" : name)
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share(file: file)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        let alert = UIAlertController(
            title: "Download failed",
            message: "The file could not be saved. Check your connection and try again.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        topViewController.present(alert, animated: true)
    }
}

// MARK: - Offline page bridge

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "retry" { load(lastRequestedURL ?? startURL) }
    }
}

/// Forwards script messages without retaining the real handler.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
