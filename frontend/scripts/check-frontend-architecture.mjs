#!/usr/bin/env node
/**
 * Frontend architecture ratchets. Counts and sets that may shrink but not grow.
 *
 * `oversizedProductionFiles` +2 (2026-08-19) — `lib/founderObjects.ts` (1162) and
 * `lib/founderOpsApi.ts` (1007), the founder-operations pass. Both are the shape
 * `creationObjectRegistry.ts` and `workflow-builder/nodeKinds.ts` were allowlisted
 * for two entries down: a self-documented single source of truth whose whole value
 * is that there is one of it. `founderObjects.ts` is the spec registry every founder
 * card is DECLARED in — splitting it by domain would put `invoice` and `bill` in
 * different files and make "which kinds exist" two greps. `founderOpsApi.ts` is the
 * one typed client for the founder-ops routes, and the reason no component embeds a
 * fetch. Splitting either would fight the DRY rule it exists to serve.
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
 *
 *   797 → 799 (`useClientFiles`, 2026-08-15) — two of the three the résumé and
 *   paid-media work added. `components/freelance/ProfileResumePanel.tsx` uploads a
 *   file, previews a template on hover and saves on a different cadence from the
 *   profile around it, none of which a server render can do.
 *   `components/widgets/registry-modules/paidMediaWidgets.tsx` is four widget
 *   bodies over `useSharedSource`, whose entire purpose is that the four pinned
 *   together cost one request — a hook, and therefore client.
 *
 *   799 → 800 (`useClientFiles`, 2026-08-15) — `components/freelance/JobAlertsPanel.tsx`.
 *   A standing search is created, toggled and deleted entirely by clicking, and the
 *   panel owns its own reads so the gigs surface never fetches alerts it may not
 *   show. Nothing about it renders before the first interaction.
 *
 *   800 → 798 (`useClientFiles`, 2026-08-15) — a TIGHTENING, and the third time
 *   the answer was to delete the directive rather than raise the number. The
 *   diagram/drive/job-alerts batch landed `CanvasDriveBrowser.tsx`,
 *   `DiagramConvertPanel.tsx` and `JobAlertsPanel.tsx`, each carrying
 *   `'use client'` and each imported by EXACTLY ONE module — `CanvasFilesPanel`,
 *   `CreationCanvas` and `MarketplaceGigsSection` — every one of which already
 *   declares the boundary. All three are genuinely interactive, which is the
 *   question the directive does NOT answer: a module imported by a client module
 *   is client code either way, so the directive changed nothing except this
 *   count. Removed in all three, with the reason written at the top of each so
 *   the next person does not put it back. Note the count came in BELOW the
 *   baseline; leaving 800 there would have been two points of slack for the next
 *   regression to spend silently, which is how a ratchet goes slack without
 *   anyone deciding it should.
 *
 *   798 → 799 (`useClientFiles`, 2026-08-16) — `app/references/ReferencesClient.tsx`.
 *   The reference list is add / edit / select / issue-a-link, none of which a
 *   server render can do. Its ROUTE root is deliberately not client: `page.tsx`
 *   is a Server Component that reads its heading through `getTranslations` and
 *   mounts this below, so the feature costs one client file and zero client-rooted
 *   pages. The share view (`references/shared/[token]`) is a Server Component
 *   too — an employer reading it never interacts with anything.
 *
 *   799 → 800 (`useClientFiles`, 2026-08-16) — `components/marketing/
 *   CompareArenaTabs.tsx`, the arena tab strip on `/compare`. Selecting a tab is
 *   the whole component, so it holds the one piece of state and the roving
 *   focus the ARIA tabs pattern requires. What it deliberately does NOT own is
 *   the content: the six comparison PANELS are rendered by the Server Component
 *   page and handed in as a `ReactNode[]`, so six matrices and their catalog
 *   reads stay on the server and the client boundary costs exactly one index.
 *   That is the shape to copy — a client file whose interactivity is real and
 *   whose payload is somebody else's.
 *
 *   The THIRD, `components/resume/ResumeDocumentView.tsx`, is why this is +2 and
 *   not +3: it had the directive and needed none. Props in, paper out, no hook and
 *   no handler. Its interactive hosts pull it into their bundle by importing it,
 *   and removing it lets `PublicResumeView` — an async Server Component serving the
 *   public share link — render the document on the server, which is where a page
 *   whose whole job is to be shared and indexed wants to be. Check for that shape
 *   before raising this number: the directive is sometimes the bug.
 *
 *   800 → 801 (`useClientFiles`, 2026-08-16) — `components/creation-canvas/
 *   canvasSurfaceActions.tsx`, the context that lets a canvas SURFACE put its own
 *   controls into the one session bar. A provider is the boundary by definition:
 *   it holds state and hands it down through context, neither of which a server
 *   render has.
 *
 *   801 → 802 (`useClientFiles`, 2026-08-16) — `components/templates/
 *   TemplateGallery.tsx`, the template grid. It is +1 and not +4 because the rest
 *   of the templates feature deliberately does not spend the budget: `/templates`
 *   is a Server Component that reads its heading through `getTranslations` and
 *   mounts this below (zero client-rooted pages), and `GuidedSetupPanel` and
 *   `useTemplateCatalog` carry NO directive — every module that imports them
 *   already declares the boundary, so the directive would have changed nothing
 *   except this count. The deep link `/templates?open=<key>` is the other half of
 *   the saving: a `/templates/<key>` route was the obvious shape and would have
 *   cost a second client file rendering a second copy of the same wizard.
 *
 *   802 → 803 (`useClientFiles`, 2026-08-16) — `components/legal/
 *   CanvasUsageCorner.tsx`, the canvas's own bottom-right usage-meter corner
 *   (the counterpart `LegalCorner` stands down for on a stage route). It reads
 *   `usePathname()`, a client-only hook, the same reason its sibling
 *   `LegalCorner.tsx` already carries the directive — mounted alongside it in
 *   `AppShell.tsx`, which is itself already a client boundary, but a component
 *   that reads a client-only hook declares its own rather than depending on
 *   whichever parent happens to render it today.
 *
 *   803 → 802 (`useClientFiles`, 2026-08-17) — a TIGHTENING. `CanvasUsageCorner.tsx`
 *   was the wrong surface entirely: consumption meters floating over the board
 *   in a fixed bottom-right overlay, when the intended placement (per the CSS
 *   comment on `.usage-meter` — "sits above the legal menu" — and the
 *   hired.video reference it was modelled on) was the left sidebar's own
 *   "USAGE" section. `UsageMeter.tsx` already built exactly that and already
 *   carried its own `'use client'`; it was simply never mounted in `Sidebar.tsx`.
 *   Deleting the corner and wiring `<UsageMeter />` into the sidebar (above
 *   `LegalStrip`) fixes the placement and removes a directive rather than
 *   adding one.
 *
 *   802 → 801 (`useClientFiles`, 2026-08-17) — a second TIGHTENING, found while
 *   fixing the ratchet's own drift: the live count (807) no longer matched the
 *   803 recorded two entries up, five files having picked up `'use client'`
 *   with no changelog entry to argue for them. Audited all five plus the two
 *   pre-existing unlisted additions against every importer. Four were genuine
 *   boundaries and stay exactly as they were — `ReferencesClient.tsx` and
 *   `LegalDocumentShareViewer.tsx` are each the client entry point under a
 *   Server Component route root; `CompareArenaTabs.tsx` and
 *   `TemplateGallery.tsx` document the same shape themselves. Six were not:
 *   `CanvasLegalDocumentUpload.tsx` (sole importer `CreationNode.tsx`, already
 *   client), `LegalStrip.tsx` (sole importer `Sidebar.tsx`, already client),
 *   `SearchPicker.tsx` (both importers already inside a client boundary —
 *   `WorkflowNodePicker.tsx` directly, `CanvasObjectPicker.tsx` via
 *   `CreationCanvas`), `WorkflowNodePicker.tsx` (sole importer
 *   `WorkflowBuilder.tsx`, already client), `WorkflowRunHistoryPanel.tsx`
 *   (both importers — `WorkflowsContent.tsx`, `WorkflowBuilder.tsx` — already
 *   client) and `workflowRunUi.tsx` (no hooks at all: style constants plus one
 *   presentational `StatusPill`). Every one is the exact shape the "800 → 798"
 *   entry above already found twice — a directive that changes nothing except
 *   this count, because the client boundary was already established upstream.
 *   Directive removed in all six, with the reason written at the top of each.
 *   The two oversized-file violations found in the same pass —
 *   `creationObjectRegistry.ts` and `workflow-builder/nodeKinds.ts` — are not
 *   this ratchet, but were the same kind of unreconciled drift: both are
 *   self-documented single-source-of-truth registries ("the single source of
 *   truth for the builder palette", "adding a node kind is a single edit"),
 *   so splitting them would fight the DRY reason they exist. Allowlisted in
 *   `oversizedProductionFiles` instead, beside the twenty other legitimate
 *   entries already there.
 *
 *   801 -> 802 (`useClientFiles`, 2026-08-18) -- `lib/useRequireAuth.ts`, the one
 *   auth guard for pages that require a signed-in visitor. It is a hook over
 *   `useRouter` + `useEffect` + the auth context, so it can only ever run on the
 *   client, and it carries the directive for the same reason every other hook in
 *   `lib/` does. It is +1 and not +2 because the band it shipped beside --
 *   `components/home/AboutAppSection.tsx` -- deliberately does NOT take one: the
 *   homepage is its only importer and is already a boundary, exactly the shape
 *   the tightenings above kept finding. The hook exists because twelve surfaces
 *   had each hand-rolled "redirect to /login when signed out", and all twelve
 *   were about to become wrong at once: `AuthProvider` no longer blanks the tree
 *   while it reads the stored session (that blanking is what made every
 *   server-rendered page an empty document), so a guard that acts before
 *   `authReady` now bounces signed-in users to the login screen. One place owns
 *   that rule.
 *
 *   802 -> 804 (`useClientFiles`, 2026-08-18) -- two client ENTRY POINTS under
 *   Server Component route roots, which is the one shape this ratchet's changelog
 *   has consistently accepted (`ReferencesClient.tsx`,
 *   `LegalDocumentShareViewer.tsx`). `app/lti/launch/LtiLaunchClient.tsx` reads
 *   `?error=` from `useSearchParams` to say why a verified LMS launch did not open
 *   a board; `app/marketplace/publish-gig/PublishGigClient.tsx` is the board picker
 *   the storefront's Talent -> Gigs publish CTA now opens, and it fetches, filters
 *   and publishes. Each is the sole client child of a `page.tsx` that stays a
 *   Server Component, so the directive marks a boundary that genuinely begins there.
 *
 *   It is +2 and not +3 because the third file added in the same pass --
 *   `components/security/IdentityProvidersPanel.tsx` -- deliberately does NOT take
 *   one: `SecurityClient.tsx` is its only importer and is already a boundary, which
 *   is exactly the shape the tightenings above kept finding.
 *
 *   804 -> 805 (`useClientFiles`, 2026-08-18) -- `components/manager/
 *   ManagerBlockedPrs.tsx`, the panel that finally lets a person ACT on the
 *   retired-PR pile. Its whole reason to exist is interaction: it holds the
 *   selection of finished-ticket PRs, opens the destructive confirm, calls the
 *   bulk-close endpoint and drops the rows that closed. None of that is a server
 *   render. It costs exactly one client file and zero client-rooted pages, and it
 *   takes NO payload of its own -- the ranked pile is handed in as a prop from the
 *   overview `ManagerContent` already holds, so the panel adds a boundary and not
 *   a second fetch. That is the same shape `CompareArenaTabs.tsx` above documents:
 *   interactivity that is real, payload that is somebody else's.
 *
 *   805 -> 806 (`useClientFiles`, 2026-08-19) -- `components/sell/ProspectDealView.tsx`,
 *   the BUYER's page behind a prospect share link (`/deal/<token>`). It is the client
 *   entry point under a Server Component route root, the same shape
 *   `LegalDocumentShareViewer.tsx` and `ReferencesClient.tsx` are already allowed for --
 *   and it could not be anything else: the page's whole job beyond rendering is to measure
 *   attention honestly (an IntersectionObserver plus `visibilitychange`, so a dwell clock
 *   stops behind a backgrounded tab) and to take an acceptance, both of which are browser
 *   APIs and local state. The route file itself stays a Server Component and carries the
 *   `noindex` metadata, which is where that belongs.
 *
 *   806 -> 807 (`useClientFiles`, 2026-08-19) -- net +1 across four files, and the
 *   arithmetic is the point. TWO were added: `components/invoice/PublicInvoice.tsx`
 *   and `components/investor/DataRoomShareViewer.tsx`, the third and fourth pages in
 *   the token-authorised family `LegalDocumentShareViewer.tsx` and `SignerConsole`
 *   already hold. Each is the client entry under a Server Component route root, and
 *   neither could be anything else: the token rides the query string (read from
 *   `window.location`), and the invoice additionally has to survive the payment
 *   processor's redirect back to its own URL and post the returned session id.
 *
 *   TWO were removed in the same pass, and they are the more interesting half:
 *   `components/board/WorkspaceAllowanceBanner.tsx` and
 *   `components/cofounder/FounderPaperwork.tsx` each carried a directive they did not
 *   need. `TaskMgmtContent.tsx` and `CofounderMatching.tsx` are their only importers
 *   and both are already boundaries, so the directive marked nothing -- the exact
 *   shape the `IdentityProvidersPanel.tsx` note above describes. A redundant
 *   `'use client'` is not free: it is what makes this number drift upward without any
 *   new interactivity, which is the drift this ratchet exists to see.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printDelta, readTallies, tallyByFile, writeTallies } from './lib/ratchetDelta.mjs';

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

/**
 * Per-file tallies beside the counts. A count ratchet that fails with a number and
 * nothing else sends whoever hit it to reconstruct the delta by hand — for these two that
 * is ~800 paths compared against the last green commit. The set ratchets below never had
 * the problem because they name their offender; the count ratchets now borrow the same
 * courtesy from `lib/ratchetDelta`.
 */
const TALLY_PATH = resolve(here, '.frontend-architecture-tally.json');
const tallies = {
  useClientFiles: tallyByFile(client.map(rel)),
  useClientPages: tallyByFile(clientPages.map(rel)),
};
const recorded = readTallies(TALLY_PATH);

const violations = [];
/** Ratchets whose failure the tally can explain, in the order they were checked. */
const countFailures = [];
function ratchetCount(label, key, actual, maximum) {
  if (actual > maximum) {
    violations.push(`${label}: ${actual} exceeds baseline ${maximum}`);
    countFailures.push({ label, key });
  }
}
function ratchetSet(label, actual, allowed) {
  const permitted = new Set(allowed);
  for (const item of actual) if (!permitted.has(item)) violations.push(`${label}: new violation ${item}`);
}

ratchetCount("'use client' files", 'useClientFiles', client.length, baseline.useClientFiles);
ratchetCount("client-rooted pages", 'useClientPages', clientPages.length, baseline.useClientPages);
ratchetSet('presentation -> infrastructure', presentationInfrastructureImports, baseline.presentationInfrastructureImports);
ratchetSet('presentation engine construction', directEngineConstruction, baseline.directEngineConstruction);
ratchetSet('production files over 800 lines', oversizedProductionFiles, baseline.oversizedProductionFiles);
ratchetSet('circular static imports', importCycles, baseline.importCycles);

if (violations.length) {
  console.error('❌  Frontend architecture ratchet failed:\n\n  - ' + violations.join('\n  - '));
  // Which files moved it. A raise is legitimate — the header above is where it is argued —
  // but it has to be argued for NAMED files, and until now the guard would not say which.
  for (const { label, key } of countFailures) printDelta(label, recorded[key], tallies[key]);
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

// Green: this tree is a legitimate reference point, so it is the one worth recording.
// Without this the sidecar is never written and `printDelta` can only ever report that no
// tally exists — the explanation would be wired up and permanently empty.
if (writeTallies(TALLY_PATH, tallies)) {
  console.log(`   Recorded per-file tallies to ${relative(resolve(here, '..'), TALLY_PATH).split('\\').join('/')}.`);
}

console.log(`✅  Frontend architecture ratchet passed (${client.length} client files, ${clientPages.length} client pages, ${oversizedProductionFiles.length} grandfathered large files, 0 import cycles).`);
// Green: a legitimate reference point, and therefore the one worth recording.
if (writeTallies(TALLY_PATH, tallies)) console.log('   Recorded per-file tallies to scripts/.frontend-architecture-tally.json.');
