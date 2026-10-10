# Mobile apps

The iOS and Android apps are shells around the web product, not rewrites. Everything the site gains, the apps gain on the next page load, and there is exactly one implementation of every feature to test. What the shells add is what a browser tab cannot give: an icon on the home screen, quick actions, deep links, a native offline page, and (on Android) a home-screen widget.

## iOS: WKWebView shell

`apps/ios` is generated from `project.yml` by XcodeGen, so the project file is reviewable text. Bundle id `ai.qubit16.app`, iOS 15+, iPhone and iPad, Swift 5.

`WebViewController.swift` (about 400 lines) is the whole app:

- `WKAppBoundDomains` and `limitsNavigationsToAppBoundDomains` restrict the web view to `qubit16.ai` and `www.qubit16.ai`.
- Any other `http(s)` main-frame navigation opens in an `SFSafariViewController` sheet and the in-app load is cancelled; `mailto:`, `tel:` and `sms:` go to the system.
- Pull-to-refresh, a progress bar driven by `estimatedProgress`, edge-swipe back and forward, recovery when the content process terminates, and a branded offline page with a retry handler.
- Downloads use `WKDownload` when a response is an attachment or a non-displayable type, then present the share sheet, which is how notebook and bundle exports work.
- Four quick actions (simulator, course, paths, visualizations) and Universal Links (`applinks:qubit16.ai`) both route into the single web view, and only app hosts are accepted, so a deep link cannot point the shell at a foreign host.
- The user agent carries `Qubit16App/ios`.

The background colours are the site's `--bg` tokens for dark and light, so nothing flashes a foreign colour during load or rubber-band overscroll. CI builds the project unsigned for the simulator on every change to `apps/ios/`.

## Android: Trusted Web Activity

`apps/android` uses Google's `androidbrowserhelper` to launch `https://qubit16.ai/?app=android` as a Trusted Web Activity: the device's verified browser renders the site full-screen, with no browser chrome, once the site's `.well-known/assetlinks.json` lists the signing certificate's fingerprint. Until then the app falls back to a branded Custom Tab. `minSdk 26`, `targetSdk 36`, release builds minified and resource-shrunk, signing read from environment variables so no key ever enters the repository.

The **Quantum Tip** widget is a Jetpack Glance app widget: a daily glossary term from a 21-entry offline list, recoloured with the web dark tokens, refreshed near local midnight by a WorkManager job, opening the app on tap. It gives the listing a genuinely native feature. Display mode was changed from immersive to default because immersive collided with the site's bottom tab bar.

## How the site knows it is inside an app

`apps/web/lib/app-shell.ts` has two levels of detection:

- `isAppShell()` is true in any installed context (the native shells, a standalone PWA, iOS home-screen web app). The site then shows an on-screen back button on non-root routes, because a shell has no browser chrome, and suppresses the "install this app" prompt.
- `isStoreApp()` is true only inside the two store apps. A small inline script runs before first paint and marks `<html data-store-app>` when the user agent carries `Qubit16App`, when the referrer is `android-app://ai.qubit16.app` (which Chrome sets for a TWA), or when the URL carries `?app=android`. The flag is remembered in `sessionStorage` for that tab only, so it never leaks into ordinary Chrome browsing of the site.

## Store compliance: no purchases in the apps

Google Play's payments policy and App Store guideline 3.1.1 refuse apps that sell digital subscriptions through an outside checkout. Rather than implement two billing systems, the apps sell nothing: inside them, a single CSS rule hides every link to `/pricing` and every element tagged `data-store-hide`, the pricing page shows "Subscriptions are not sold in the app" with the contact block, the search palette drops the pricing entry, and `/api/billing/checkout` refuses the iOS user agent with 403 as a backstop. Subscriptions are bought on the website and the apps reflect whatever plan the account has. Because the hiding is a CSS rule keyed on the `href`, a pricing link added anywhere in the future is covered automatically.

## What the shells deliberately do not do

They do not hold any state of their own, they do not reimplement any screen, and they do not bypass any server check: a request from the app is a request from a browser as far as every route handler is concerned.
