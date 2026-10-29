/**
 * The tsup configuration every published package shares — written ONCE.
 *
 * Nine `tsup.config.ts` files carried the same eight options (esm+cjs, dts,
 * sourcemap, clean, `dist`, the `.mjs`/`.cjs` extension map) and differed only
 * in their entries, their externals and, for the two browser snippets, an IIFE
 * global. A shared setting that has to change — a target, a `treeshake` flag,
 * the extension map — is one edit here rather than nine.
 *
 * Plain ESM so tsup's config loader takes it without a build step; each package
 * imports it relatively (`../scripts/tsup.base.mjs`) because these packages
 * have no shared install to resolve a bare specifier from.
 */

/** The `.mjs`/`.cjs` pair every package publishes. */
function moduleExtension({ format }) {
  return { js: format === 'esm' ? '.mjs' : '.cjs' };
}

/**
 * The declaration build's TypeScript options, applied at THIS one seam.
 *
 * tsup's rollup dts step injects `baseUrl: compilerOptions.baseUrl || "."` into the
 * program it hands to the TS 6 JS API (`@typescript/typescript6`, which is what
 * `typescript` resolves to in these packages). TS 6 rejects `baseUrl` as deprecated
 * (TS5101) unless `ignoreDeprecations: "6.0"` is set. The tsconfigs deliberately do
 * NOT carry it: the native TS 7 `tsc` reads them, so they stay TS 7-clean.
 *
 * @param {import('tsup').Options['dts']} dts
 * @returns {import('tsup').Options['dts']}
 */
export function withDtsCompilerOptions(dts) {
  if (!dts) return dts;
  const given = dts === true ? {} : dts;
  return { ...given, compilerOptions: { ...given.compilerOptions, ignoreDeprecations: '6.0' } };
}

/**
 * A library build: esm + cjs with rolled-up declarations.
 *
 * @param {object} options
 * @param {string[] | Record<string, string>} options.entry
 * @param {string[]} [options.external] Packages the consumer provides (React, peers).
 * @param {import('tsup').Options['dts']} [options.dts] Override the declaration build.
 * @param {Partial<import('tsup').Options>} [options.extra] Anything else, spread last.
 * @returns {import('tsup').Options}
 */
export function libraryConfig({ entry, external = [], dts = true, extra = {} }) {
  return {
    entry,
    format: ['esm', 'cjs'],
    dts: withDtsCompilerOptions(dts),
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    external,
    outExtension: moduleExtension,
    ...extra,
  };
}

/**
 * A library that is ALSO a `<script>` snippet: the library formats plus an IIFE
 * that assigns `globalName` on `window` (`dist/*.global.js`).
 *
 * @param {object} options
 * @param {string[]} options.entry
 * @param {string} options.globalName
 * @returns {import('tsup').Options}
 */
export function browserSnippetConfig({ entry, globalName }) {
  return {
    ...libraryConfig({ entry }),
    format: ['esm', 'cjs', 'iife'],
    globalName,
    outExtension({ format }) {
      if (format === 'iife') return { js: '.global.js' };
      return moduleExtension({ format });
    },
  };
}

/** The peers a React component library never bundles. */
export const REACT_EXTERNALS = ['react', 'react-dom', 'react/jsx-runtime'];
