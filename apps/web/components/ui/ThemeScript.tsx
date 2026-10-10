/**
 * ThemeScript — the anti-flash script.
 *
 * WHY A BLOCKING INLINE SCRIPT IS THE ONLY THING THAT WORKS
 * --------------------------------------------------------
 * The theme lives in `localStorage`, which the server cannot read, so the HTML
 * Next.js streams is theme-agnostic: <html> arrives with no class and the CSS
 * default (dark) applies. Anything that runs LATER than "before the first paint"
 * shows the user the wrong theme first and then corrects it — a white-to-dark or
 * dark-to-white flash on every navigation-free load:
 *
 *   · a React effect (`useEffect`) runs after hydration — hundreds of ms late;
 *   · `next/script` with any strategy other than `beforeInteractive` is late;
 *   · `<script src>` (even without defer) blocks on a network round trip;
 *   · `type="module"` is deferred by definition;
 *   · a CSS-only solution cannot express "an explicit stored choice overrides
 *     `prefers-color-scheme`", because CSS cannot read localStorage.
 *
 * A parser-blocking inline <script> in <head> is the one construct that is
 * guaranteed to execute after <html> exists and before the first paint. So this
 * component renders exactly that.
 *
 * ON dangerouslySetInnerHTML
 * --------------------------
 * This is the single justified use of `dangerouslySetInnerHTML` in the app.
 * React has no other way to emit raw script text (it escapes children). The
 * content is a STATIC STRING LITERAL defined in this file — no props, no user
 * input, no data from the request ever reaches it, so there is no injection
 * surface. Any future edit must keep that property.
 *
 * This is a server component: it has no client bundle cost at all.
 */

/**
 * Kept deliberately tiny (it is parser-blocking, so every byte is on the
 * critical path) and dependency-free (it runs before any bundle loads).
 *
 * Contract, mirroring lib/theme/useTheme.ts:
 *   · stored 'light' | 'dark'  -> pin that theme
 *   · stored 'system' or absent -> follow prefers-color-scheme, dark if unknown
 *   · always writes an explicit class, so CSS never has to guess afterwards
 *   · wrapped in try/catch: localStorage throws in Safari private mode and in
 *     third-party iframes with cookies blocked, and a throw here would abort
 *     head parsing.
 *
 * The 'quantum-lab.theme' key and the class names are duplicated from
 * lib/theme/tokens.ts on purpose — importing them would pull a module graph
 * into a string that must stay standalone. tokens.ts documents the coupling.
 */
const THEME_SCRIPT = `(function(){try{
var k="quantum-lab.theme",s=null;
try{s=localStorage.getItem(k)}catch(e){}
var t=(s==="light"||s==="dark")?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");
var d=document.documentElement;
d.classList.remove("light","dark");
d.classList.add(t);
d.style.colorScheme=t;
var m=document.querySelector('meta[name="color-scheme"]');
if(m)m.setAttribute("content",s==="light"||s==="dark"?t:"light dark");
}catch(e){}})()`

export default function ThemeScript() {
  return (
    <script
      // eslint-disable-next-line react/no-danger -- see the file header: static literal, no user input, and the only way to block paint.
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  )
}
