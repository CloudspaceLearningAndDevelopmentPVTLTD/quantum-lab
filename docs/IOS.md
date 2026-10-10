# iOS app — architecture, build, and what is still yours to do

Written 2026-10-04, alongside `apps/ios/`. Companion to [`ANDROID.md`](ANDROID.md):
same product, same decision, the other platform. Read this before touching the
iOS project.

**Status:** the project generates with XcodeGen, compiles in Xcode and in the
`ios.yml` workflow (unsigned simulator build), and runs in the iOS Simulator,
where the site has been exercised end to end inside the WKWebView shell
(October 2026). It has not been run on a physical iPhone or submitted to the App
Store. §6 lists exactly what is still unverified.

---

## 1. The decision: a WKWebView shell, not a rewrite

Same reasoning as Android (`ANDROID.md` §1): the simulator, 44+ visualizations,
the AI tutor, hardware jobs and billing are one implementation on the web.
Rewriting them in Swift would create a second codebase that drifts on day two.
So `apps/ios` is a thin native shell around `https://qubit16.ai`. There is **no
product logic in Swift.**

Unlike Android, iOS has no Trusted Web Activity. The only way to show a web
product full-screen is `WKWebView`, which gives you a bare engine and none of a
browser's behaviour. Most of `WebViewController.swift` is the behaviour a web
view does *not* give you for free:

| Behaviour | Why it is there |
|---|---|
| Edge-swipe back/forward, pull-to-refresh, load progress bar | An app with no way back feels broken |
| Branded offline screen (`Resources/offline.html`) | Otherwise first launch with no network is a blank view |
| External links open in a Safari sheet | Stripe checkout, mailto, other sites must not navigate the product's own view away |
| `WKDownload` + share sheet | Certificate and OpenQASM exports do nothing in a bare web view |
| JS `alert`/`confirm`/`prompt` | A bare `WKWebView` drops them; the site uses `confirm()` for "reset progress" |
| Reload on web-process termination | iOS kills the web process under memory pressure (easy with a WebGL viz open); without this the view goes permanently blank |
| `WKAppBoundDomains` + `limitsNavigationsToAppBoundDomains` | **WebKit only runs service workers in an app's web view for declared domains.** Without this the site's offline mode (`public/sw.js`) would not work on iOS at all |
| Universal Links | A shared `qubit16.ai` link opens the app |
| Home-screen quick actions | Simulator / Course / Paths / Visualizations, mirroring Android's shortcuts |
| User-agent token `Qubit16App/ios` | The site detects it (`apps/web/lib/app-shell.ts`) to show a back button and hide the "install" prompt |

### What the web app does for the shells

Both stores' apps load the same site, so the mobile UX lives there, not in Swift
or Kotlin (`apps/web`, see `RESPONSIVE.md`):

* **A bottom tab bar** (`components/ui/MobileTabBar.tsx`) below 1280px: Learn,
  Visualize, Simulate, Tutor, More. It hides while the keyboard is up.
* **Safe areas.** `viewport-fit=cover` (`app/layout.tsx`) plus `env(safe-area-inset-*)`
  in the header, tab bar and fixed banners, so nothing sits under the notch,
  Dynamic Island or home indicator.
* **A back chevron** in the header inside any app shell, on every non-root route
  (`SiteNav.tsx`) — iOS web views have no browser back button.
* No tap delay, no grey tap flash, 44px minimum targets, pinch-zoom left on.

---

## 2. Building it (on a Mac)

```sh
brew install xcodegen
cd apps/ios
xcodegen generate            # writes Qubit16.xcodeproj from project.yml
open Qubit16.xcodeproj
```

Simulator build with no signing, as CI does:

```sh
xcodebuild -project Qubit16.xcodeproj -scheme Qubit16 \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

`Qubit16.xcodeproj` is deliberately **not committed** (`.gitignore`): a `.pbxproj`
is unreviewable machine output. `project.yml` is the source of truth.

---

## 3. What only you can do

None of this can or should be done unattended: it needs your Apple identity,
money, or legal declarations.

1. **Apple Developer Program** — $99/year, in your name or an organisation's.
2. **Team ID.** Put it in `project.yml` (`DEVELOPMENT_TEAM`) and replace
   `REPLACE_WITH_APPLE_TEAM_ID` in
   `apps/web/public/.well-known/apple-app-site-association`, then deploy the web
   app. (`next.config.mjs` already serves that extensionless file as
   `application/json`, which Apple's verifier needs.) Check with
   `https://qubit16.ai/.well-known/apple-app-site-association`.
3. **App Store Connect record** with bundle id `ai.qubit16.app`, then
   Product ▸ Archive ▸ Distribute in Xcode. Bump `CURRENT_PROJECT_VERSION` in
   `project.yml` on every upload.
4. **The listing**: screenshots (`apps/ios/store/` has the right sizes),
   description, keywords, support URL, privacy policy URL
   (`https://qubit16.ai/privacy` exists), age rating.
5. **Privacy "nutrition labels"** in App Store Connect. `PrivacyInfo.xcprivacy`
   declares email address (account sign-in, linked, not tracking). Answer the
   labels truthfully for what the *site* collects, not just what this shell does.

---

## 4. App Review — the two things most likely to get this rejected

I would rather you hear these from me than from Apple.

**Guideline 4.2 (minimum functionality).** Apple rejects apps that are "just a
website in a wrapper". This one is a *rich* web app (a real simulator, offline
mode, downloads, deep links, quick actions) and the shell adds genuine native
behaviour, which is the standard that gets through — but it is a judgement call
by a human reviewer, not a guarantee. If it is rejected on 4.2, the fix is to add
a native feature that is visibly useful, and the obvious one is a **WidgetKit
home-screen widget** — Android already ships the equivalent ("Quantum Tip",
`apps/android/.../widget/`). It is the planned response if a reviewer raises 4.2.

**Guideline 3.1.1 (in-app purchase).** Qubit16 sells Pro/Team subscriptions
through **Stripe** (`/pricing` → `/api/billing/checkout` → `checkout.stripe.com`).
Apple requires in-app purchase for digital content and subscriptions sold *inside*
an app, with exceptions that depend on region and category. This shell opens
Stripe in a Safari sheet, which is still a purchase flow reachable from inside the
app.

**Resolved (2026-10-09): purchase UI is hidden inside the app** — the first
option below. Inside the app the site removes every `/pricing` link, upgrade
button and checkout, and `/api/billing/checkout` refuses the app's user agent;
users subscribe on the website and the app reflects their plan. Details and the
mechanism: `docs/BILLING.md` § "Store apps". The options as they were weighed:

* *Hide purchase UI inside the iOS app* (users subscribe on the website and sign
  in; the app just reflects their plan). Lowest effort — the site already knows
  it is in the shell (`isNativeShell()`) — and the usual approach for apps like
  this. Costs some conversion.
* *Implement StoreKit IAP* and map receipts to plans. Correct, but Apple takes a
  15–30% cut and it is a real chunk of work (server-side receipt validation).
* *Rely on a regional external-purchase entitlement.* Availability has changed
  repeatedly; check Apple's current terms for your storefronts before relying on it.

Resolved 2026-10-09: the first option is implemented — see the note above and
docs/BILLING.md § "Store apps".

---

## 5. Files

```
apps/ios/project.yml                       XcodeGen spec (Info.plist + entitlements generated from it)
apps/ios/Qubit16/AppDelegate.swift         @main
apps/ios/Qubit16/SceneDelegate.swift       window; routes launch, Universal Links, quick actions
apps/ios/Qubit16/WebViewController.swift   the whole app (§1 table)
apps/ios/Qubit16/Config.swift              URL, allowed hosts, UA token, brand colours
apps/ios/Qubit16/Resources/offline.html    offline screen
apps/ios/Qubit16/Resources/PrivacyInfo.xcprivacy
apps/ios/Qubit16/Assets.xcassets/          1024px opaque icon, launch mark, colours
apps/web/public/.well-known/apple-app-site-association   Universal Links (placeholder Team ID)
.github/workflows/ios.yml                  builds it on a macOS runner (unverified, see §6)
```

---

## 6. What is NOT verified

* **A physical device.** Everything below the Simulator line is unverified on real
  hardware: notch insets, the system share sheet for downloads, background/foreground
  transitions.
* `limitsNavigationsToAppBoundDomains` + `loadHTMLString(baseURL: nil)` for the
  offline page: the offline page should be exempt (it is not an http(s)
  navigation), but it has not been exercised with the network actually off.
* That service workers actually start under App-Bound Domains on a device.
* Universal Links, until the Team ID is filled in and the site redeployed.
* The 4.2 and 3.1.1 outcomes in §4 — only Apple can tell you.
* Safari-specific rendering on a **real notch** (`env()` insets, the 100vh family
  of bugs). The layout has been checked in the iOS Simulator's WebKit at phone
  size, which covers the rendering engine but not the physical safe area.
