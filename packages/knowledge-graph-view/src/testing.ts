/**
 * `@builderforce/knowledge-graph-view/testing` — the WS3 fixture graphs (code, docs and
 * mixed) and a scripted `KnowledgeGraphSource`. Every host renders these fixtures (Rovr's
 * WS6 acceptance is "renders the WS3 fixtures identically"). Type-only imports from
 * memory, so this module runs anywhere.
 */

import type { Finding, KEdge, KNode, KnowledgeGraph, ReviewPlan, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphSource, KnowledgeReviewEvent, ReviewControl, ReviewRequest } from './types';

const src = (root: string, path: string) => `src:${root}::${path}` as const;

function node(root: string, path: string, extra: Partial<KNode> = {}): KNode {
    return { ref: src(root, path), kind: 'file', label: path, pack: 'docs', importance: 0.5, origin: 'extracted', sourceHash: `h:${path}`, ...extra };
}
function edge(from: string, to: string, kind: string, extra: Partial<KEdge> = {}): KEdge {
    return { from: from as KEdge['from'], to: to as KEdge['to'], kind, weight: 1, origin: 'extracted', ...extra };
}
function finding(kind: string, pack: string, nodes: string[], severity: Finding['severity'], params: Finding['params']): Finding {
    const key = kind.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    return { id: `${kind}:${nodes.join('|')}`, kind, pack, nodes: nodes as Finding['nodes'], severity, params, requestKey: `knowledgeGraph.fix.${key}` };
}
function graph(rootId: string, packs: string[], nodes: KNode[], edges: KEdge[], findings: Finding[]): KnowledgeGraph {
    return {
        scope: { rootId, packs, digest: `d:${rootId}` }, nodes, edges, findings,
        stats: { sources: nodes.filter((n) => n.kind === 'file').length, nodes: nodes.length, edges: edges.length, stale: nodes.filter((n) => n.stale).length, truncated: false },
    };
}

export function codeFixture(root = 'code'): KnowledgeGraph {
    const c = (path: string, partition: string, importance: number, badges?: KNode['badges']) =>
        node(root, path, { pack: 'code', partition, importance, ...(badges ? { badges } : {}) });
    const nodes = [
        c('app/page.tsx', 'presentation', 0.9),
        c('app/billing.tsx', 'presentation', 0.6, { cloneGroup: 'g1' }),
        c('application/charge.ts', 'application', 0.7, { cloneGroup: 'g1' }),
        c('domain/invoice.ts', 'domain', 1),
        c('infrastructure/db.ts', 'infrastructure', 0.4),
        c('infrastructure/legacy.ts', 'infrastructure', 0.1, { unused: 'file' }),
    ];
    const [page, billing, charge, invoice, db, legacy] = nodes.map((n) => n.ref) as [string, string, string, string, string, string];
    const edges = [
        edge(page, charge, 'references', { verdict: 'allowed' }),
        edge(page, db, 'references', { verdict: 'skips' }),
        edge(charge, invoice, 'references', { verdict: 'allowed' }),
        edge(invoice, charge, 'references', { verdict: 'upward', cycle: true }),
        edge(charge, invoice, 'references', { verdict: 'allowed', cycle: true }),
        edge(db, invoice, 'references', { verdict: 'allowed' }),
        edge(billing, charge, 'duplicate', { weight: 0.9 }),
    ];
    return graph(root, ['code'], nodes, edges, [
        finding('partition-violation', 'code', [invoice, charge], 'error', { verdict: 'upward', from: 'domain', to: 'application', kind: 'references' }),
        finding('partition-violation', 'code', [page, db], 'warn', { verdict: 'skips', from: 'presentation', to: 'infrastructure', kind: 'references' }),
        finding('cycle', 'code', [charge, invoice], 'warn', { nodes: 2 }),
        finding('clone-group', 'code', [billing, charge], 'warn', { group: 'g1', members: 2 }),
        finding('unused-file', 'code', [legacy], 'info', { count: 1, files: 1 }),
    ]);
}

/**
 * A small system with entry points, areas and the code-pack badges the surface reads: two
 * entry files (one inside an area, one in an area-less `cron/` folder), four layers, coverage,
 * complexity, churn, owners and patterns on some files, and two findings.
 */
export function surfaceFixture(root = 'sys'): KnowledgeGraph {
    const area = (name: string, importance: number): KNode =>
        node(root, `area/${name}`, { kind: 'area', label: name, pack: 'code', importance });
    const a = (name: string) => src(root, `area/${name}`) as KNode['ref'];
    const f = (path: string, partition: string, areaName: string | null, importance: number, badges?: KNode['badges']) =>
        node(root, path, { pack: 'code', partition, importance, ...(areaName ? { area: a(areaName) } : {}), ...(badges ? { badges } : {}) });
    const nodes = [
        area('Web app', 0.6), area('API', 0.9), area('repositories', 0.4),
        f('web/main.tsx', 'entry', 'Web app', 0.5),
        f('web/page.tsx', 'presentation', 'Web app', 0.4),
        f('api/routes.ts', 'presentation', 'API', 0.7, { complexity: 30, maxComplexity: 9, churn: 12, routes: 'GET /users/:id;POST /users' }),
        f('api/useCase.ts', 'application', 'API', 0.8, { complexity: 12, coverage: 0.8, churn: 4, owner: 'platform', patterns: 'repository, adapter' }),
        f('db/repo.ts', 'infrastructure', 'repositories', 0.4, { complexity: 5, coverage: 0.2, churn: 2, owner: 'platform', cloneGroup: 'g1' }),
        f('cron/job.ts', 'entry', null, 0.1),
    ];
    const ref = (path: string) => src(root, path);
    const edges = [
        edge(ref('web/main.tsx'), ref('web/page.tsx'), 'references', { verdict: 'allowed' }),
        edge(ref('web/page.tsx'), ref('api/routes.ts'), 'references', { verdict: 'allowed' }),
        edge(ref('api/routes.ts'), ref('api/useCase.ts'), 'references', { verdict: 'allowed' }),
        edge(ref('api/useCase.ts'), ref('db/repo.ts'), 'references', { verdict: 'allowed' }),
        edge(ref('cron/job.ts'), ref('api/useCase.ts'), 'references', { verdict: 'skips' }),
    ];
    return graph(root, ['code'], nodes, edges, [
        finding('partition-violation', 'code', [ref('cron/job.ts'), ref('api/useCase.ts')], 'error', { verdict: 'skips', from: 'entry', to: 'application', kind: 'references' }),
        finding('clone-group', 'code', [ref('db/repo.ts'), ref('api/routes.ts')], 'warn', { group: 'g1', members: 2 }),
    ]);
}

export function docsFixture(root = 'docs'): KnowledgeGraph {
    const d = (path: string, partition: string, importance: number) => node(root, path, { partition, importance });
    const a = d('lease.md', '(root)', 0.9), b = d('policy/termination.md', 'policy', 0.6), o = d('notes/old.md', 'notes', 0.1);
    const sec = node(root, 'lease.md#termination', { kind: 'section', label: 'lease.md › Termination', partition: '(root)', importance: 0.5 });
    const missing = node(root, 'policy/missing.md', { kind: 'missing', label: 'missing.md', importance: 0 });
    const claimA: KNode = { ref: 'fact:claim:a', kind: 'claim', label: 'Notice is 30 days', pack: 'docs', importance: 0.3, origin: 'model' };
    const claimB: KNode = { ref: 'fact:claim:b', kind: 'claim', label: 'Notice is 60 days', pack: 'docs', importance: 0.3, origin: 'model', stale: true };
    const fact: KNode = { ref: 'fact:note:1', kind: 'fact', label: 'Legal owns the lease', pack: 'docs', importance: 0.2, origin: 'human' };
    const nodes = [a, b, o, sec, missing, claimA, claimB, fact];
    const edges = [
        edge(a.ref, sec.ref, 'contains'),
        edge(sec.ref, b.ref, 'links'),
        edge(b.ref, missing.ref, 'links'),
        edge(claimA.ref, sec.ref, 'about', { origin: 'model' }),
        edge(claimB.ref, b.ref, 'about', { origin: 'model' }),
        edge(claimA.ref, claimB.ref, 'contradicts', { origin: 'model', confidence: 0.9 }),
        edge(fact.ref, a.ref, 'about', { origin: 'human' }),
    ];
    return graph(root, ['docs'], nodes, edges, [
        finding('broken-link', 'docs', [b.ref, missing.ref], 'warn', { count: 1, file: 'policy/termination.md' }),
        finding('orphan', 'docs', [o.ref], 'info', { count: 1 }),
        finding('contradiction', 'docs', [claimA.ref, claimB.ref], 'warn', {}),
        finding('stale', 'docs', [b.ref, claimB.ref], 'warn', { count: 1 }),
    ]);
}

export function mixedFixture(root = 'mixed'): KnowledgeGraph {
    const code = codeFixture(root), docs = docsFixture(root);
    return graph(root, ['code', 'docs'], [...code.nodes, ...docs.nodes], [...code.edges, ...docs.edges], [...code.findings, ...docs.findings]);
}

export const FIXTURE_PLAN: ReviewPlan = {
    rootId: 'docs', files: 3, byPack: { docs: 3 }, unchanged: 1, changed: ['lease.md', 'policy/termination.md'], removed: [], skipped: [], estimatedModelCalls: 4,
};

export const FIXTURE_REPORT: ReviewReport = {
    rootId: 'docs', digest: 'd', extracted: 2, judged: 4, unjudged: 0, invalidJudgements: 0, factsWritten: 3,
    relationsWritten: 2, staleMarked: 2, aborted: false, durationMs: 10, readErrors: 0,
    extractErrors: 0, failures: [], awaitingJudge: [],
};

export interface FixtureSource extends KnowledgeGraphSource {
    requests: ReviewRequest[];
    confirmed: boolean[];
}

/** A source over fixture graphs. Its review plans {@link FIXTURE_PLAN}, waits for the confirm, then reports. */
export function fixtureSource(graphs: KnowledgeGraph[], opts: { review?: boolean } = {}): FixtureSource {
    const byRoot = new Map(graphs.map((g) => [g.scope.rootId, g] as const));
    const s: FixtureSource = {
        requests: [],
        confirmed: [],
        async scopes() {
            return graphs.map((g) => ({ rootId: g.scope.rootId, title: g.scope.rootId, packs: g.scope.packs }));
        },
        async load(rootId) { return byRoot.get(rootId) ?? null; },
        ...(opts.review === false ? {} : {
            review(req: ReviewRequest, ctl: ReviewControl): AsyncIterable<KnowledgeReviewEvent> {
                s.requests.push(req);
                return (async function* () {
                    const plan = { ...FIXTURE_PLAN, ...(req.force ? { unchanged: 0 } : {}) };
                    yield { type: 'plan', plan } as const;
                    const ok = await ctl.confirm(plan);
                    s.confirmed.push(ok);
                    if (!ok) { yield { type: 'cancelled' } as const; return; }
                    yield { type: 'progress', progress: { phase: 'extract', done: 1, total: 2, path: 'lease.md' } } as const;
                    yield { type: 'done', rootId: plan.rootId, report: FIXTURE_REPORT } as const;
                })();
            },
        }),
    };
    return s;
}

/** What `openList` needs from testing-library, injected so this module imports none (it ships in the source-only package). */
export interface ListOpener {
    screen: {
        findByRole(role: 'radio', options: { name: string }, waitFor?: { timeout?: number }): Promise<Element>;
        findByTestId(id: string, options?: undefined, waitFor?: { timeout?: number }): Promise<HTMLElement>;
    };
    fireEvent: { click(element: Element): unknown };
}

/** The camera bar appears only after the graph has loaded and laid out; a role query over a big jsdom tree is slow, so wait generously. */
const CAMERA_WAIT = { timeout: 20_000 };

/**
 * The view opens on the Map (or the 2D graph without entry points); tests that read the list (its accessible text
 * alternative) switch to it with this. It waits for the camera bar to exist, so it does not depend on load timing.
 */
export async function openList({ screen, fireEvent }: ListOpener, name = 'List'): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('radio', { name }, CAMERA_WAIT)); // the View group is a segmented radio group
    return screen.findByTestId('kg-list', undefined, CAMERA_WAIT);
}

/** Findings render their rows only once a group is opened: opens every collapsed group under `root`. */
export function expandAllFindings({ fireEvent }: Pick<ListOpener, 'fireEvent'>, root: ParentNode): void {
    for (const toggle of root.querySelectorAll('button[aria-expanded="false"]')) fireEvent.click(toggle);
}
