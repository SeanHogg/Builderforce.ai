// @ts-check
//
// `eslint-config-next` is a MAJOR ahead of `next` (16.x against 15.x), on purpose
// and not as drift. v16 is the first release that exports flat config natively —
// the two `require`s below spread straight into the array — where 15.x needs
// `FlatCompat` to be usable under ESLint 9 at all. Pinning back to 15.x would
// mean reintroducing that shim to lint the same rules, so the pair stays split
// until `next` itself moves. The rule this repo cares about is that the lint
// SURFACE is whatever `next` actually ships, and the six rules below are where
// the two versions disagree; they are handled explicitly rather than inherited.
const nextConfig = require('eslint-config-next');
const nextCoreWebVitalsConfig = require('eslint-config-next/core-web-vitals');

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores: ['.next/**', '.vercel/**', 'node_modules/**'] },
  ...nextConfig,
  ...nextCoreWebVitalsConfig,
  {
    // eslint-plugin-react-hooks v6 + the React Compiler plugin ship several
    // strict ergonomics rules (set-state-in-effect, refs, purity, immutability,
    // preserve-manual-memoization) plus a stricter exhaustive-deps that fire on
    // ~200 pre-existing, legitimate, working patterns across the app — the
    // standard fetch-on-mount effect, ref mirrors, manual memoization, and
    // conditional-fetch effects this codebase (and React itself) uses everywhere.
    // They are advisory, not correctness errors, and the repo already routinely
    // overrides exhaustive-deps inline. Rewriting every call site to appease them
    // is a large, behaviour-changing refactor and is explicitly OFF here so the
    // build and lint stay clean.
    //
    // OFF HERE DOES NOT MEAN UNWATCHED. `scripts/check-react-hooks-ratchet.mjs`
    // turns these six back on for itself and holds a per-file count that may only
    // FALL. `npm test` runs it as `check:react-hooks --changed`, over the files
    // the branch actually touched — a full sweep is ~10 minutes because four of
    // the six run the React Compiler. A new file starts at zero, an edited file
    // may not get worse, and `.react-hooks-baseline.txt` IS the debt: 348 files,
    // 673 warnings. That replaced a roadmap entry whose own figure — "~72
    // warnings demoted to warn" — was wrong twice over: they are off, not warn,
    // and the count was an order of magnitude low.
    rules: {
      'react-hooks/set-state-in-effect':         'off',
      'react-hooks/refs':                        'off',
      'react-hooks/purity':                      'off',
      'react-hooks/immutability':                'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/exhaustive-deps':             'off',
    },
    // With exhaustive-deps off, the many existing inline
    // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments would
    // otherwise be reported as unused directives — don't flag them.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
];

module.exports = config;
