/**
 * What a BUILT package imports — the pure core of `check-publishable-deps.mjs`.
 *
 * A package's `dist` is what consumers install, so every bare specifier in it must
 * resolve from the package's own `dependencies`/`peerDependencies` (or Node). A
 * private package that was meant to be bundled but leaked as an import
 * (`@webdit/runtime`) installs fine locally through a `file:` link and breaks only
 * for the consumer; this is the check that sees it.
 */
import { builtinModules } from 'node:module';

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** `from "x"`, side-effect `import "x"`, `import("x")`, `require("x")`, `export * from "x"`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g;

/** The package name of a specifier: `a/b` -> `a`, `@s/p/x` -> `@s/p`. */
export function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** True for relative, absolute, `node:`/builtin, `data:`, `http(s):` and `#` specifiers. */
function isNotAPackage(specifier) {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    /^(data|https?|blob):/.test(specifier) ||
    BUILTINS.has(specifier) ||
    BUILTINS.has(packageNameOf(specifier))
  );
}

/**
 * The bare package names a built file imports.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
export function bareImports(source) {
  const found = new Set();
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[2];
    if (!isNotAPackage(specifier)) found.add(packageNameOf(specifier));
  }
  return found;
}

/**
 * Imports of `source` that the package does not declare.
 *
 * @param {string} source
 * @param {{ dependencies?: object, peerDependencies?: object }} pkg
 * @param {Iterable<string>} [allow] explicit allowlist of package names
 * @returns {string[]}
 */
export function undeclaredImports(source, pkg, allow = []) {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...allow,
  ]);
  return [...bareImports(source)].filter((name) => !declared.has(name)).sort();
}
