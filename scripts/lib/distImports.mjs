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
const SPECIFIER_HEAD = String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)`;

/**
 * A quoted npm package specifier: an optional `@scope/`, a lowercase name, then optional subpath
 * segments. Anything else between the quotes is not a package import - in minified output a
 * `from`/`import` token followed by a quote can otherwise swallow a whole run of code up to the
 * next quote. Relative, absolute, `node:` and `data:` specifiers fail this shape and are skipped,
 * which is the same outcome the not-a-package filter below gives them.
 */
const PACKAGE_SPECIFIER = String.raw`((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.@-]+)*)`;

const SPECIFIER = new RegExp(`${SPECIFIER_HEAD}(["'])${PACKAGE_SPECIFIER}\\1`, 'g');

/** Lines that are only a comment (JSDoc examples in declaration files quote imports that are not imports). */
const COMMENT_LINE = /^\s*(?:\*|\/\/|\/\*)/;

const withoutCommentLines = (source) =>
  source.split('\n').filter((line) => !COMMENT_LINE.test(line)).join('\n');

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
  for (const match of withoutCommentLines(source).matchAll(SPECIFIER)) {
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
