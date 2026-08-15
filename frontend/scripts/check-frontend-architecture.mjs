#!/usr/bin/env node
/**
 * Frontend architecture ratchets. Counts and sets that may shrink but not grow.
 *
 * The baseline lives in `.frontend-architecture-baseline.json`, which is data
 * and therefore has nowhere to put a reason. So a raise is justified HERE, in
 * prose, and a raise with no entry below is a raise nobody argued for:
 *
 *   786 → 787 (`useClientFiles`, 2026-08-15) — `components/marketing/
 *   MethodologySection.tsx`. It is the single renderer of the Idea→Real method
 *   for four marketing pages, two of which are Server Components
 *   (`/features`, `/about`) and two of which are Client Components
 *   (`/pricing`, `/sell-builderforce`). `useTranslations` is the only
 *   translation API that works under both, and it needs the client boundary
 *   here because no non-`'use client'` component in this tree uses it — making
 *   this the file that finds out whether that works is not a trade worth taking
 *   for one ratchet point. The alternative was two copies of the same markup,
 *   which is the drift the component exists to prevent.
 *
 *   789 → 792 (`useClientFiles`, migration 0469) — the three surfaces founder
 *   operations added, each of which is a FORM somebody fills in and submits:
 *   `components/forms/PublicFormResponder.tsx` (the public form responder),
 *   `components/signature/SignerConsole.tsx` (the signer) and
 *   `components/cofounder/CofounderMatching.tsx` (co-founder matching).
 *   The two public ones were the case worth arguing and the argument goes the
 *   other way from the usual: rendering them on the server and submitting from
 *   the client would be two components maintaining one shape, and the shape —
 *   which questions exist, which are required, what a signer was shown — is
 *   precisely the part that must not drift. Their `page.tsx` wrappers stay
 *   Server Components, so the route boundary is unchanged.
 *
 *   792 → 796 (`useClientFiles`, 2026-08-15) — the canvas SURFACE split.
 *   `canvasSurfaceContext.tsx` is a React context provider, which has no
 *   server form at all: a provider that does not run on the client provides
 *   nothing. The three that consume it are interactive by definition —
 *   `CanvasChatSurface.tsx` (a live transcript), `CanvasSurfaceSwitcher.tsx`
 *   (the control that changes surface) and `CanvasAdsPanel.tsx` (a panel that
 *   reads and mutates connected ad accounts). `CanvasSurfaceRouter.tsx` is
 *   deliberately NOT among them: it chooses which surface to mount and does
 *   that on the server, which is the boundary this ratchet exists to keep
 *   somebody thinking about.
 *
 *   796 → 797 (`useClientFiles`, 2026-08-15) — `CanvasMiroPanel.tsx`, the Miro
 *   import browser. It has no server form: every interesting thing it does is a
 *   round trip driven by a click (list the boards, then WALK a cursor to the end
 *   of one, reporting progress as it goes), and a server component cannot report
 *   progress on work it has already finished. It sits beside `CanvasDrivePanel`
 *   in every respect including this one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const baseline = JSON.parse(readFileSync(resolve(here, '.frontend-architecture-baseline.json'), 'utf8'));

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = collect(src);
const source = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const rel = (file) => relative(src, file).split('\\').join('/');
const production = files.filter((file) => !/\.(?:test|spec)\.tsx?$/.test(file));
const client = files.filter((file) => /^\s*['"]use client['"];/.test(source.get(file)));
const clientPages = client.filter((file) => /(?:^|\/)app\/.*\/page\.tsx$/.test(rel(file)) || rel(file) === 'app/page.tsx');
const presentationInfrastructureImports = production
  .filter((file) => /^(?:app|components)\//.test(rel(file)))
  .filter((file) => /from\s+['"]@\/infrastructure\//.test(source.get(file)))
  .map(rel);
const directEngineConstruction = production
  .filter((file) => /^(?:app|components)\//.test(rel(file)))
  .filter((file) => /new\s+(?:WebGPUTrainer|MambaEngine|MambaModelProvider)\s*\(/.test(source.get(file)))
  .map(rel);
const oversizedProductionFiles = production
  .filter((file) => source.get(file).split(/\r?\n/).length > 800)
  .filter((file) => rel(file) !== 'lib/content.ts')
  .map(rel);

/**
 * CIRCULAR STATIC IMPORTS — the one ratchet here that guards a crash rather than
 * a shape.
 *
 * A cycle of `import` statements is a cycle of module EVALUATION, and the module
 * that gets evaluated second sees the first one's `const`s in their temporal dead
 * zone. Read one at module scope and the page does not render at all — it throws
 * `Cannot access 'X' before initialization` before React starts, so there is no
 * error boundary and no partial page, just white. That is exactly how
 * `aiInsightPanels -> AiImpactLens -> WidgetGrid -> widgets/registry ->
 * allWidgets -> hubWidgets -> aiInsightPanels` took down every route including
 * the marketing homepage: the root layout mounts the panel providers, so every
 * visitor entered the loop.
 *
 * What makes it worth a build guard is that the crash is not local to the change
 * that causes it. Every module in the loop is individually correct; the failure
 * appears only in a bundle, only in whichever order the bundler happens to reach
 * them, and it moves when an unrelated import is added elsewhere. So the rule is
 * the whole cycle, not the top-level read: no static import cycles, at all.
 *
 * The escape hatch is the fix, not an exemption — `dynamic(() => import(...))`.
 * An async edge takes no part in module-evaluation order, so it cannot form an
 * initialization loop, and a registry that only needs a component when something
 * renders wanted to be lazy anyway.
 *
 * Type-only imports are erased before runtime and are not counted.
 */
const byPath = new Map(files.map((file) => [file, true]));
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = resolve(src, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    if (byPath.has(candidate)) return candidate;
  }
  return null;
}
// `import ... from 'x'` and `export ... from 'x'`, both minus their type-only forms.
const VALUE_IMPORT = /^\s*import\s+(?!type\s)[\s\S]*?\s*from\s*['"]([^'"]+)['"]/gm;
const VALUE_REEXPORT = /^\s*export\s+(?!type\s)(?:\*|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/gm;
const graph = new Map();
for (const file of files) {
  const edges = new Set();
  for (const pattern of [VALUE_IMPORT, VALUE_REEXPORT]) {
    pattern.lastIndex = 0;
    for (let match; (match = pattern.exec(source.get(file))); ) {
      const target = resolveImport(match[1], file);
      if (target && target !== file) edges.add(target);
    }
  }
  graph.set(file, edges);
}
// Tarjan: every strongly-connected component of more than one module is a cycle.
const order = new Map();
const lowlink = new Map();
const onStack = new Set();
const stack = [];
const importCycles = [];
let counter = 0;
function visit(root) {
  // Explicit stack — the graph is ~1,400 modules deep in places and recursion overflows.
  const work = [[root, 0]];
  while (work.length) {
    const frame = work[work.length - 1];
    const [node] = frame;
    if (frame[1] === 0) {
      order.set(node, counter);
      lowlink.set(node, counter);
      counter += 1;
      stack.push(node);
      onStack.add(node);
    }
    const edges = [...(graph.get(node) ?? [])];
    if (frame[1] < edges.length) {
      const next = edges[frame[1]];
      frame[1] += 1;
      if (!order.has(next)) work.push([next, 0]);
      else if (onStack.has(next)) lowlink.set(node, Math.min(lowlink.get(node), order.get(next)));
      continue;
    }
    work.pop();
    if (work.length) {
      const parent = work[work.length - 1][0];
      lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(node)));
    }
    if (lowlink.get(node) === order.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) importCycles.push(component.map(rel).sort().join(' <-> '));
    }
  }
}
for (const file of files) if (!order.has(file)) visit(file);

const violations = [];
function ratchetCount(label, actual, maximum) {
  if (actual > maximum) violations.push(`${label}: ${actual} exceeds baseline ${maximum}`);
}
function ratchetSet(label, actual, allowed) {
  const permitted = new Set(allowed);
  for (const item of actual) if (!permitted.has(item)) violations.push(`${label}: new violation ${item}`);
}

ratchetCount("'use client' files", client.length, baseline.useClientFiles);
ratchetCount("client-rooted pages", clientPages.length, baseline.useClientPages);
ratchetSet('presentation -> infrastructure', presentationInfrastructureImports, baseline.presentationInfrastructureImports);
ratchetSet('presentation engine construction', directEngineConstruction, baseline.directEngineConstruction);
ratchetSet('production files over 800 lines', oversizedProductionFiles, baseline.oversizedProductionFiles);
ratchetSet('circular static imports', importCycles, baseline.importCycles);

if (violations.length) {
  console.error('❌  Frontend architecture ratchet failed:\n\n  - ' + violations.join('\n  - '));
  if (violations.some((entry) => entry.startsWith('circular static imports'))) {
    console.error(
      '\n  A static import cycle crashes the page it is bundled into with\n' +
      "  \"Cannot access 'X' before initialization\" — before React mounts, so no\n" +
      '  error boundary catches it. Break the cycle at the edge that does not need\n' +
      '  its target until render time:\n\n' +
      "    const Lens = dynamic(() => import('./Lens').then((m) => m.Lens), { ssr: false });\n\n" +
      '  Do not add it to the baseline.',
    );
  }
  process.exit(1);
}
console.log(`✅  Frontend architecture ratchet passed (${client.length} client files, ${clientPages.length} client pages, ${oversizedProductionFiles.length} grandfathered large files, 0 import cycles).`);
