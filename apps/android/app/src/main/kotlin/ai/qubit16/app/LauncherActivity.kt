package ai.qubit16.app

/**
 * The entire "app". Everything a user sees — the simulator, all 44+
 * visualizations, the course, the AI tutor, hardware job submission, billing,
 * Learning Paths, the Glossary — is the real https://qubit16.ai, rendered by
 * the device's verified browser engine inside a Trusted Web Activity, not a
 * WebView and not a reimplementation. This class exists only so the manifest
 * has a stable name under our own package; all the actual TWA behaviour
 * (launch URL, splash, status bar colour, asset-link verification, fallback
 * to a branded Custom Tab if verification or Chrome is unavailable) is
 * configured declaratively via the <meta-data> entries in AndroidManifest.xml
 * and implemented by androidbrowserhelper — Chrome's own TWA library — which
 * this subclasses unchanged.
 *
 * See docs/ANDROID.md for why this architecture (not a native rewrite) is the
 * right one for this app specifically.
 */
class LauncherActivity : com.google.androidbrowserhelper.trusted.LauncherActivity()
