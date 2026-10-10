import UIKit

/// Owns the window and routes every way the app can be asked to open something —
/// cold launch, a Universal Link, a home-screen quick action — to the one web view.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var web: WebViewController?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let controller = WebViewController(startURL: Self.launchURL(from: connectionOptions))
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = controller
        window.backgroundColor = AppConfig.background
        window.makeKeyAndVisible()
        self.window = window
        self.web = controller
    }

    /// The URL a cold launch should open: a tapped link, else a quick action,
    /// else nil (the web view then opens the site's home page).
    private static func launchURL(from options: UIScene.ConnectionOptions) -> URL? {
        if let url = options.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb })?.webpageURL,
           AppConfig.isAppHost(url) {
            return url
        }
        if let item = options.shortcutItem, let path = AppConfig.shortcutPaths[item.type] {
            return AppConfig.appURL(path: path)
        }
        return nil
    }

    // Universal Link while the app is already running.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
              let url = userActivity.webpageURL,
              AppConfig.isAppHost(url) else { return }
        web?.open(url)
    }

    // Quick action while the app is already running.
    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard let path = AppConfig.shortcutPaths[shortcutItem.type],
              let url = AppConfig.appURL(path: path) else {
            completionHandler(false)
            return
        }
        web?.open(url)
        completionHandler(true)
    }
}
