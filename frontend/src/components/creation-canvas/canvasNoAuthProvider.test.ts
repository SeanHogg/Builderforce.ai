import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **The canvas renders where there is NO `AuthProvider`.**
 *
 * `AuthContext.tsx` throws `useAuth must be used within an AuthProvider`, and
 * `useAuth()` has been called, three separate times, by code that runs on the
 * canvas's FIRST mount — which is inside the VS Code webview and the `/embed`
 * route, where the web app's root layout (and with it the provider) is not
 * compiled. Each throw happened during the first render pass, so it took the
 * whole board down: no chrome, no error boundary, just a blank canvas.
 *
 * Why three times, and why no test caught any of them: `src/test/setup.ts`
 * stubs `@/lib/AuthContext` globally, so `useAuth()` returns a signed-in owner
 * in EVERY suite whether or not a provider is mounted. The crash is therefore
 * invisible to component tests by construction — they assert against the stub,
 * not the real context. Any canvas module can reintroduce it tomorrow and the
 * whole suite stays green.
 *
 * So this asserts the IMPORT GRAPH instead of a render: neither the canvas, nor
 * anything it directly renders, may call `useAuth`. `useViewerSession` is the
 * supported replacement — it answers from the provider when there is one and
 * from the embedded tenant token when there is not.
 *
 * The scope is deliberately TWO HOPS, not the whole transitive closure. The
 * full closure also reaches web-app-only surfaces (`StudioAccountControl`,
 * `EmailSignInForm`, the workforce roster) that the canvas never RENDERS
 * because their parents are gated off; flagging those would be a guard
 * everyone learns to ignore. One hop past the canvas is where "the canvas
 * renders this" stops being true.
 */

const SRC = join(process.cwd(), 'src');
const CANVAS_DIR = join(SRC, 'components/creation-canvas');
const CANVAS_ENTRY = join(CANVAS_DIR, 'CreationCanvas.tsx');

/** The boundary itself: the one module that legitimately throws. */
const AUTH_BOUNDARY_OWNERS = new Set(['lib/AuthContext.tsx', 'lib/viewerSession.ts']);

function readIfFile(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Comments explain WHY a file avoids `useAuth` — they must not count as calling it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function resolve(spec: string, fromFile: string): string | null {
  let target: string | null = null;
  if (spec.startsWith('@/')) target = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) target = join(fromFile, '..', spec);
  else return null; // a package, not ours
  for (const candidate of [`${target}.ts`, `${target}.tsx`, join(target, 'index.ts'), join(target, 'index.tsx')]) {
    if (readIfFile(candidate) !== null) return candidate;
  }
  return null;
}

/** Named imports of `useAuth` itself — `useOptionalAuth` shares the module, not the defect. */
function importsUseAuth(source: string): boolean {
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]*AuthContext['"]/g;
  for (const m of stripComments(source).matchAll(importRe)) {
    const named = (m[1] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]);
    if (named.includes('useAuth')) return true;
  }
  return false;
}

/** The canvas, plus everything it renders directly. */
function canvasSurface(): string[] {
  const roots = walk(CANVAS_DIR);
  const direct = new Set<string>();
  for (const file of roots) {
    const source = readIfFile(file);
    if (source === null) continue;
    for (const m of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
      const hit = resolve(m[1], file);
      if (hit) direct.add(hit);
    }
  }
  return [...new Set([...roots, ...direct])];
}

const rel = (file: string) => relative(SRC, file).replace(/\\/g, '/');

describe('the canvas tree, where there is no AuthProvider', () => {
  const surface = canvasSurface();

  it('reaches the canvas and its rendered surface, for this to mean anything', () => {
    // A guard that traversed to nothing would pass the case below vacuously.
    expect(surface).toContain(CANVAS_ENTRY);
    expect(surface.length).toBeGreaterThan(150);
    // `useViewerSession` — what these fixes moved to — must itself be in the
    // surface, or the rule would push callers somewhere off-limits.
    expect(surface).toContain(join(SRC, 'lib/viewerSession.ts'));
  });

  it('never calls useAuth() from a module the canvas renders', () => {
    const offenders = surface
      .map((file) => ({ file, source: readIfFile(file) ?? '' }))
      .filter(({ file }) => !AUTH_BOUNDARY_OWNERS.has(rel(file)))
      .filter(({ source }) => importsUseAuth(source) && /\buseAuth\s*\(/.test(stripComments(source)))
      .map(({ file }) => rel(file));

    expect(offenders).toEqual([]);
  });
});