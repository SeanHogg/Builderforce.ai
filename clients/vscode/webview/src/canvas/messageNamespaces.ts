import fs from 'node:fs';
import path from 'node:path';

/**
 * Which message namespaces the canvas bundle ships — DERIVED, not listed.
 *
 * The web catalogs are ~600 KB per locale and the canvas reads a fraction of
 * them, so shipping all five in full would add ~3 MB to the VSIX for strings no
 * editor surface can reach. But a hand-written list of namespaces is exactly the
 * kind of thing that rots: the canvas compiles ~120 frontend modules it does not
 * own, a missing namespace renders raw keys rather than throwing, and the
 * failure would surface weeks later inside an editor panel.
 *
 * So the trim is computed from the source: walk the real import closure from
 * `CreationCanvas.tsx` and collect every `useTranslations('…')` literal. Add a
 * namespace on the web and the next build picks it up.
 *
 * Build-time only (it reads the filesystem) — used by the `bf-canvas-messages`
 * plugin in `vite.canvas.config.ts` and by `messageNamespaces.test.ts`.
 */

/** Resolve an import specifier the way the canvas Vite config does. */
function resolveImport(spec: string, from: string, frontendSrc: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(frontendSrc, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every first-party module the canvas bundle can reach from `entry`.
 *
 * Follows DYNAMIC imports as well as static ones: the heavy surfaces (the IDE,
 * the Evermind studio, the adapter trainer) are lazily loaded, and they are
 * still part of this bundle — their namespaces have to ship or those panels
 * render raw keys the moment someone opens them.
 */
export function canvasImportClosure(entry: string, frontendSrc: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(match[1], file, frontendSrc);
      if (resolved) visit(resolved);
    }
  };
  visit(entry);
  return [...seen].filter((file) => !/\.test\.tsx?$/.test(file));
}

/** The TOP-LEVEL namespaces to ship (`creationCanvas.node` rides inside `creationCanvas`). */
export function collectCanvasNamespaces(entry: string, frontendSrc: string): string[] {
  const namespaces = new Set<string>();
  for (const file of canvasImportClosure(entry, frontendSrc)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/useTranslations\(\s*(?:'([^']+)'|"([^"]+)")\s*\)/g)) {
      namespaces.add((match[1] ?? match[2]).split('.')[0]);
    }
  }
  return [...namespaces].sort();
}

/** Conventional locations, so callers don't each re-derive the same two paths. */
export function canvasPaths(webviewDir: string): { frontendSrc: string; entry: string } {
  const frontendSrc = path.resolve(webviewDir, '../../../frontend/src');
  return {
    frontendSrc,
    entry: path.join(frontendSrc, 'components/creation-canvas/CreationCanvas.tsx'),
  };
}
