import UIKit

/// Everything about the shell that is a decision rather than logic, in one place.
enum AppConfig {
    /// The product. The whole app is this site — see docs/IOS.md for why it is a
    /// shell around it and not a rewrite.
    static let startURL = URL(string: "https://qubit16.ai/")!

    /// Hosts that stay inside the app. Anything else opens in an in-app Safari
    /// sheet (see WebViewController.decidePolicyFor), which is how Stripe
    /// checkout, mailto links and external references are handled.
    static let appHosts: Set<String> = ["qubit16.ai", "www.qubit16.ai"]

    /// Appended to the web view's user agent. The site reads it
    /// (apps/web/lib/app-shell.ts) to know it is inside an app: it adds an
    /// on-screen back button (iOS web views have no browser chrome) and hides the
    /// "install this app" prompt. MUST stay equal to NATIVE_SHELL_UA_TOKEN there.
    static let userAgentToken = "Qubit16App/ios"

    /// Home-screen quick actions -> paths. Keys are the
    /// UIApplicationShortcutItemType values declared in project.yml.
    static let shortcutPaths: [String: String] = [
        "simulator": "/simulator",
        "learn": "/learn",
        "paths": "/paths",
        "visualizations": "/visualizations",
    ]

    /// Same values as apps/web/app/globals.css `--bg`, dark and light, so the
    /// strip behind the page during load and rubber-band overscroll never flashes
    /// a foreign colour. (Android's colors.xml lifts the same tokens.)
    static let background = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x07 / 255, green: 0x09 / 255, blue: 0x0F / 255, alpha: 1)
            : UIColor(red: 0xF7 / 255, green: 0xF8 / 255, blue: 0xFC / 255, alpha: 1)
    }

    /// `--q-violet`, for the load progress bar.
    static let accent = UIColor(red: 0x7C / 255, green: 0x6A / 255, blue: 0xF9 / 255, alpha: 1)

    /// Resolve a path or a full URL to something we are willing to load inside
    /// the app, or nil. Never returns a URL on a foreign host: a deep link must
    /// not be able to point the shell at someone else's page.
    static func appURL(path: String) -> URL? {
        URL(string: path, relativeTo: startURL)?.absoluteURL
    }

    static func isAppHost(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return appHosts.contains(host)
    }
}
