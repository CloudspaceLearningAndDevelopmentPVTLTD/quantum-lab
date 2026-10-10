import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

/**
 * ESLint, which until now did not run in this repository AT ALL.
 *
 * There was no config file of any kind and ESLint was not a dependency, so the
 * `next lint` script in package.json would have failed or dropped into Next's
 * interactive setup prompt. The CI job knew: its lint step is written to skip
 * itself and say so out loud ("lint is NOT configured in this repo and was NOT
 * run") rather than report a green check for a lint that never happened. That
 * step keys off the existence of `apps/web/eslint.config.*`, so adding THIS
 * file is what switches it on — no workflow edit is needed, and none was made.
 *
 * FLAT CONFIG, and it has to be. ESLint 9 dropped the `.eslintrc` cascade, and
 * `eslint-config-next` 16 ships flat-config entry points only. A `.eslintrc.json`
 * here would be silently ignored by ESLint 9 and the lint would "pass" having
 * checked nothing — the same false-green the CI step was written to avoid.
 *
 * The composition follows node_modules/next/dist/docs (this repo's AGENTS.md
 * requires reading those rather than working from memory, because this is not
 * the Next.js most training data describes):
 *   - core-web-vitals: the Next + React + react-hooks rules, with the rules
 *     that affect Core Web Vitals raised from warning to error.
 *   - typescript: the typescript-eslint rules, added because every source file
 *     in this app is TypeScript.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    /*
     * DO NOT report (and therefore do not auto-remove) unused disable
     * directives. This is not a style preference; it is damage control for a
     * thing that already happened twice.
     *
     * ESLint's default is to flag an `eslint-disable-next-line` whose rule is
     * not currently firing, and `--fix` then DELETES the comment. On the first
     * run of this config that silently removed two directives that carried
     * real explanations:
     *
     *   components/ui/ThemeScript.tsx  — "react/no-danger -- static literal,
     *     no user input, and the only way to block paint", guarding the one
     *     construct the CSP's threat model depends on;
     *   components/circuit/QSphere.tsx — a react-hooks/exhaustive-deps
     *     directive on a canvas effect.
     *
     * Both were restored by hand. In a codebase where a disable comment is
     * always an argument rather than a shrug, losing one to an autofix costs
     * more than a stale directive ever does — and a stale directive is
     * harmless, whereas the deletion changes behaviour AND destroys the
     * reasoning in the same edit. `npm run lint:fix` is safe to run because of
     * this setting.
     */
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },

  globalIgnores([
    // eslint-config-next's own defaults, which must be restated once anything
    // is passed to globalIgnores.
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',

    // Generated or vendored, and not ours to lint.
    'public/**',
    'node_modules/**',
    // Next rewrites this on every build/dev switch; it carries a
    // "should not be edited" banner and is already ignored above, but the
    // tsbuildinfo beside it is pure build output.
    'tsconfig.tsbuildinfo',
  ]),

  {
    /*
     * Rules relaxed for a REASON, each tied to a deliberate decision already
     * documented in the code it would otherwise flag. Nothing here is switched
     * off because it was noisy.
     */
    rules: {
      /*
       * The codebase deliberately uses <img> in exactly the places where
       * next/image is wrong (inline SVG data URIs, canvas exports, the
       * certificate renderer). Downgraded to a warning rather than off, so a
       * genuinely careless <img> still shows up in the output.
       */
      '@next/next/no-img-element': 'warn',

      /*
       * ON, as an error, and the CSP depends on it.
       *
       * lib/security/headers.ts ships `script-src 'unsafe-inline'` because
       * statically prerendered HTML cannot carry a per-request nonce, and its
       * header argues that this is survivable ONLY because the app renders
       * everything — including LLM output — through React text nodes. There is
       * exactly one audited exception, the anti-flash theme script in
       * components/ui/ThemeScript.tsx, which carries a disable comment
       * explaining why it is safe (a static literal, no user input).
       *
       * Enabling the rule is what keeps that argument true: a second
       * dangerouslySetInnerHTML added anywhere now fails lint instead of
       * quietly invalidating the CSP's stated threat model. It also stops
       * `eslint --fix` DELETING that disable comment as an unused directive,
       * which is precisely what happened on the first run of this config.
       */
      'react/no-danger': 'error',

      /*
       * BAN `toLocaleString()` WITH NO LOCALE. This is a correctness rule, not
       * a style one, and it closes a bug this codebase actually shipped.
       *
       * With no locale argument the method uses whatever locale the RUNTIME
       * resolved, and this app server-renders, so the same expression runs in
       * Node and again in the browser:
       *
       *   (100000).toLocaleString()   Node here (en-IN): "1,00,000"
       *                               browser en-US:     "100,000"
       *                               browser de-DE:     "100.000"
       *
       * React compares the two and treats any difference as a hydration
       * mismatch (error #418), discarding the server-rendered subtree and
       * re-rendering on the client — throwing away the SSR the page exists to
       * do. Measured with a de-DE browser before the fix: SEVEN routes failed
       * (/pricing, /hardware, /embed/circuit, /visualizations/grover, /shor,
       * /qec-duel, /workbench/decoder-lab). After pinning: 131/131 pass.
       *
       * CI CANNOT CATCH THIS, which is why the rule is here rather than a
       * test: CI runs Node and Chromium on one Linux box, both en-US, so the
       * two sides agree and every route passes. It needs a server and a
       * browser whose locales differ — the normal condition in production,
       * where the container's locale is fixed and every visitor brings their
       * own.
       *
       * Pass an explicit locale: 'en-US' for numbers. The app is
       * <html lang="en"> and every string in it is English, so a reader is
       * already being addressed in English by the time they reach a number.
       * `toLocaleDateString` is deliberately NOT banned — a date carries a
       * timezone decision that has to be made per call site, and several are
       * rendered only on the client where the reader's own locale is correct.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='toLocaleString'][arguments.length=0]",
          message:
            "toLocaleString() with no locale is runtime-dependent and breaks hydration (React #418). Pass a locale, for example toLocaleString('en-US').",
        },
      ],

      /*
       * THE REACT COMPILER RULE FAMILY — warnings, not errors, and this is a
       * deliberate call that should be revisited, not a silencing.
       *
       * eslint-plugin-react-hooks v6 ships the React Compiler's static checks
       * alongside the classic hook rules. This app does NOT use the React
       * Compiler. Run as errors against a codebase written without it, they
       * produced 200 failures on the first ever lint, and the overwhelming
       * majority are patterns that are correct here:
       *
       *   - `refs` (108) fires on "cannot access refs during render" across the
       *     canvas and WebGL visualizations, where a ref holding a renderer,
       *     an animation handle or a mutable simulation buffer is exactly what
       *     refs are for and re-rendering on every frame is the thing being
       *     avoided.
       *   - `set-state-in-effect` (82) fires on the standard hydration-safe
       *     pattern: localStorage cannot be read while rendering on the server,
       *     so the value is read in an effect and committed with setState.
       *     components/ui/ThemeToggle.tsx is the canonical instance, and it is
       *     correct.
       *
       * They stay ON as warnings because they are NOT all noise —
       * `react-hooks/purity` in particular flags real `Date.now()` calls during
       * render (app/review/ReviewSession.tsx, components/admin/AssignedWork.tsx),
       * which genuinely can render differently on two consecutive passes. That
       * is a real backlog and it should be worked down, not hidden; making it an
       * error today would just mean lint gets switched off again.
       *
       * `react-hooks/rules-of-hooks` is deliberately NOT in this list. It stays
       * an ERROR, it catches real bugs, and it is currently clean — the sixteen
       * failures it reported on the first run were one repeated false positive
       * from two plain functions named with a `use` prefix, and both were
       * renamed rather than exempted.
       */
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
    },
  },

  {
    /*
     * Tests and scripts are Node-side and not part of the shipped bundle, so
     * the rules about client/server boundaries and bundle weight do not apply.
     * They are still type-checked by tsc, which is where their real safety
     * comes from.
     */
    files: [
      'tests/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      'scripts/**/*.{js,mjs,ts}',
      '*.config.{ts,mjs,js}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      /*
       * `require()` is correct in these files and an import is not. Tailwind's
       * config loads its plugins with require() by design, and
       * tests/e2e/neutralizeServerOnly.ts uses it to intercept a module in
       * Node's CommonJS resolver — which is the whole point of that file and
       * cannot be expressed with a static ESM import.
       */
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
])

export default eslintConfig
