import { defineConfig, devices } from '@playwright/test'

// PW_BASE_URL lets the suite run against a server on another port — on a
// machine where :3000 is already another project's dev server (see
// docs/RESPONSIVE.md), or against a deployed preview. When it is set the suite
// assumes the server is already running and does not build one.
const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  // Two retries in CI: the suite drives real animation frames and a WebGL
  // canvas, and a cold machine occasionally loses the first attempt to a
  // scheduling hiccup. Locally a failure is a failure.
  retries: process.env.CI ? 2 : 0,
  // A trace is only worth its cost once something has already failed.
  timeout: 45_000,
  expect: {
    // Generous enough for a client component to hydrate and a canvas to mount,
    // short enough that a genuinely missing element fails fast.
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    // page.route stubs cannot see requests made by the site's own service
    // worker (public/sw.js answers same-origin /api GETs itself), so a stubbed
    // device response would be bypassed. Tests exercise the network path directly.
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      // Chromium only — CI installs no other browser.
      name: 'chromium',
      // mobile.spec.ts asserts against a 390px viewport; running it here as
      // well would fail on assertions that are true only at that width.
      testIgnore: ['**/mobile.spec.ts', '**/responsive-matrix.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.PW_CHROMIUM ?? undefined },
      },
    },
    {
      /**
       * The phone. 390x844 is the iPhone 12/13/14 logical viewport and the
       * narrowest width worth supporting — everything narrower than about 360px
       * is a rounding error in the traffic, everything wider gets more room, so
       * a layout that holds here holds everywhere.
       *
       * `hasTouch` is the point of this project, not the width: it makes
       * `.tap()` dispatch real touch events, which is how a control that
       * responds to hover and nothing else gets caught. `isMobile` additionally
       * turns on the mobile viewport meta handling.
       *
       * Chromium is still the engine — CI installs no other browser, and
       * `devices['iPhone 13']` would only swap the user-agent string, not the
       * rendering engine, so it would be a WebKit claim this suite cannot back.
       */
      name: 'mobile',
      testMatch: ['**/mobile.spec.ts', '**/responsive-matrix.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        launchOptions: { executablePath: process.env.PW_CHROMIUM ?? undefined },
      },
    },
  ],
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run start',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 180000,
      },
})
