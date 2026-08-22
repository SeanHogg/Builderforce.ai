/**
 * Which of a package's imports it FAILS TO DECLARE.
 *
 * A phantom dependency — one that resolves only because somebody else's
 * dependency tree hoisted it — is a build that works on one machine and not
 * another. `lib/markdownPipeline.ts` imported the type `PluggableList` from
 * `unified`, a transitive dependency of react-markdown that was never declared;
 * it resolved in the flat local `node_modules` and did not resolve under pnpm's
 * strict layout, so `next build` died four and a half minutes into a production
 * deploy. A type-only phantom is worse still: it costs nothing at runtime, so it
 * survives every test and shows up at the deploy.
 *
 * The same rule has to hold in two places that used to state it once each:
 * the frontend app (`frontend/scripts/check-declared-deps.mjs`) and the
 * source-only packages under `packages/`, which are the WORSE case — they ship no
 * `dist` and are never installed, so an undeclared import there is resolved by
 * whatever the CONSUMER happens to have, and the package's own manifest says
 * nothing about what consuming it costs. This module is the one implementation of
 * the comparison; scanning is `moduleImports.mjs`'s job.
 */
import { packageRoot } from './moduleImports.mjs';

/**
 * Every dependency name a manifest declares, in any of the four fields.
 *
 * `devDependencies` counts for non-test source too: a package's published `.d.ts`
 * refers to types (`@types/react`) that live there, and consumers type-check
 * against it.
 *
 * @param {Record<string, unknown>} manifest Parsed `package.json`.
 * @returns {Set<string>}
 */
export function declaredNames(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

/**
 * The names declared as RUNTIME dependencies — what a consumer inherits.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {Set<string>}
 */
export function runtimeDeclaredNames(manifest) {
  return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
}

/**
 * Turn tsconfig `paths` keys into the prefixes an import may legitimately start
 * with. `@/*` → `@/`, `@builderforce/run-context` → itself.
 *
 * @param {Record<string, unknown>} paths
 * @returns {string[]}
 */
export function aliasPrefixes(paths) {
  return Object.keys(paths ?? {}).map((key) => (key.endsWith('/*') ? key.slice(0, -1) : key));
}

/**
 * @typedef {object} UndeclaredOptions
 * @property {import('./moduleImports.mjs').ImportSite[]} imports Scanned import sites.
 * @property {Set<string>} declared         Names the manifest declares.
 * @property {Set<string>} [runtimeOnly]    When given, a NON-test import satisfied only by
 *                                          a devDependency is reported too — used for the
 *                                          source-only packages, whose consumers install
 *                                          none of their dev tree.
 * @property {string[]} [aliases]           Alias prefixes that resolve without a manifest entry.
 * @property {Map<string, string>} [allowed] specifier or package root → the REASON it needs no entry.
 * @property {(specifier: string) => boolean} [resolvedElsewhere] Specifiers another
 *                                          mechanism resolves (e.g. a sibling source-only package).
 */

/**
 * @param {UndeclaredOptions} options
 * @returns {import('./moduleImports.mjs').ImportSite[]} The offending sites, in scan order.
 */
export function undeclaredImports({ imports, declared, runtimeOnly, aliases = [], allowed, resolvedElsewhere }) {
  return imports.filter((site) => {
    const { specifier } = site;
    if (aliases.some((alias) => specifier === alias || specifier.startsWith(alias))) return false;
    if (allowed?.has(specifier) || allowed?.has(packageRoot(specifier))) return false;
    if (resolvedElsewhere?.(specifier)) return false;

    const root = packageRoot(specifier);
    if (!declared.has(root)) return true;
    // Declared — but a dev-only entry does not travel to a consumer, so a runtime
    // import satisfied only by `devDependencies` is still undeclared for them.
    return Boolean(runtimeOnly) && !site.isTest && !runtimeOnly.has(root);
  });
}

export { packageRoot };
