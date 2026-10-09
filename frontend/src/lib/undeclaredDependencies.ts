/**
 * Packages a workspace source file imports that its `package.json` does not declare.
 *
 * The workspace preview runs a real `npm install` from `package.json`, so an import of an
 * undeclared package is a dev server that fails with "Failed to resolve import" — not a
 * warning. Models routinely write `import { BrowserRouter } from 'react-router-dom'` into a
 * starter whose manifest lists only React (session `local-148925cf` did exactly that across
 * seven files), and nothing told them. The build tools answer a write with this list so the
 * model declares the package in the same turn.
 *
 * Pure and dependency-free: a regex over import/export-from/dynamic-import specifiers, then
 * a set difference against the manifest. A miss is cheap (the diagnostics tool still sees
 * the real error); a false alarm is only a suggestion.
 */

/** Files whose imports resolve through `node_modules`. */
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** `import x from 'p'`, `import 'p'`, `export { x } from 'p'`, `import('p')`. */
const SPECIFIER = /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]+\s*from\s*|\bimport\s*\(\s*)['"]([^'"\n]+)['"]/g;

/** `react-dom/client` → `react-dom`; `@scope/pkg/sub` → `@scope/pkg`; relative/absolute/URL → null. */
export function packageOfSpecifier(specifier: string): string | null {
  if (/^(?:\.|\/|[a-z]+:)/i.test(specifier)) return null;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.length >= 2 && parts[1] ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

/** The packages `source` imports, deduplicated, in first-seen order. */
export function importedPackages(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(SPECIFIER)) {
    const pkg = packageOfSpecifier(match[1]);
    if (pkg) found.add(pkg);
  }
  return [...found];
}

/**
 * The packages `source` (at `path`) imports that `packageJson` does not declare in any
 * dependency field. Empty for a non-script file, and for a manifest that is missing or does
 * not parse — there is nothing to compare against, and guessing would only add noise.
 */
export function undeclaredDependencies(path: string, source: string, packageJson: string | null): string[] {
  if (!SCRIPT_FILE.test(path) || !packageJson) return [];
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(packageJson) as Record<string, unknown>;
  } catch {
    return [];
  }
  const declared = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const entries = manifest[field];
    if (entries && typeof entries === 'object') Object.keys(entries).forEach((name) => declared.add(name));
  }
  return importedPackages(source).filter((pkg) => !declared.has(pkg));
}
