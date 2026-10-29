/**
 * The knowledge-graph PreFetch rows (PRD 38 §4.9, §3.1 "from any host") — `knowledge.review-dir`
 * and `knowledge.graph` — as DATA, with their executors over a host's review ports. Shared
 * by every host: the ones that review in their own process (the editor, on-prem) supply
 * how a folder is opened for review and how they show a graph; a browser host (web, Rovr)
 * reviews in its knowledge VIEW, so its `/review` answers with the view's launcher
 * ({@link reviewInViewExecutor}) — a folder picker needs the person's own gesture.
 *
 *   - `knowledge.review-dir` (answer, WRITE — always confirmed): `/review <dir>`, "review /
 *     map / build a knowledge graph of <dir>". Its `preview` runs `planReview` (a walk plus
 *     a manifest diff) so the confirm chip states files by pack, unchanged files and ≈ model
 *     calls; once confirmed it runs the review on the SAME plan and answers with the report
 *     and an **Open in graph** chip.
 *   - `knowledge.graph` (answer, read): `/graph`, "show me the graph". Opens the view
 *     focused on the files the text names (the ONE `extractFocusPaths`).
 *
 * `knowledge.ask` is the knowledge index's row and lives with it.
 */

import { srcRef, type PlanDetail, type ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import { extractFocusPaths } from '../focusPaths.js';
import { planDetailLine, reviewReportText } from '../knowledge/reviewText.js';
import { reviewCostSuffix, type ReviewCallPricePort } from '../knowledge/reviewCost.js';
import { OPEN_KNOWLEDGE_GRAPH_COMMAND, graphShown, openInGraphChip } from './graphChip.js';
import type { PrefetchChip, PrefetchOutput, PrefetchRow, PrefetchRunner } from './contract.js';

export { graphShown, openInGraphChip };

export const KNOWLEDGE_REVIEW_DIR = 'knowledge.review-dir';
export const KNOWLEDGE_GRAPH = 'knowledge.graph';

/** A review reads and judges a whole folder: minutes on a large one. The person asked for it. */
const REVIEW_BUDGET_MS = 30 * 60_000;
/** Opening the view is a command or a link. */
const GRAPH_BUDGET_MS = 5_000;
/** How long a previewed plan answers the confirmed run of the same request. */
const PLAN_REUSE_MS = 2 * 60_000;

const WHERE: PrefetchRow['surfaces'] = ['vscode', 'onprem', 'web'];

/** The chip command that opens a host's knowledge view on its review launcher. */
export const OPEN_KNOWLEDGE_REVIEW_COMMAND = 'builderforce.openKnowledgeReview';
/** "Choose a folder to review" — the in-view review chip's label. */
export const CHOOSE_FOLDER_LABEL_KEY = 'prefetch.chip.chooseFolderToReview';

/**
 * "Show me the graph" in the ways people say it — deterministic, never a model call. It
 * names the graph this system draws (the graph, the knowledge / dependency / import / code
 * / layer graph) or its layers, after a view verb. A graph of someone's DATA ("show me a
 * graph of revenue") is not one, and the bare "the graph" must stand alone or name a path.
 * Duplicates, clones and cycles are `dup.check` / `deps.cycles` — they answer with their own
 * Open in graph chip.
 */
const VIEW = '(?:show|open|see|display|view)(?: me)?';
/** A path: has a separator, or a dot followed by an extension character ("Q3." and "revenue." are sentences). */
const PATH_LIKE = '\\S*(?:[/\\\\]|\\.\\w)\\S*';
/** What a code graph shows: files and the structure around them. */
const CODE_NOUNS = '(?:files?|modules?|layers?|partitions?|packages?|folders?|directories|imports|dependencies)';
const ENDING = '\\s*(?:please|now)?[.!?]*\\s*$';
const GRAPH_PATTERNS: RegExp[] = [
    // A graph named by what it is: "open the knowledge graph", "show me the dependency graph of src/".
    new RegExp(`\\b${VIEW} (?:the |our |this )?(?:knowledge|dependency|import|code|layer)[- ](?:graph|map)\\b`, 'i'),
    // The bare "graph": on its own, or of a path — never "the graph of revenue".
    new RegExp(`\\b${VIEW} the graph(?:\\s+(?:of|for)\\s+${PATH_LIKE})?${ENDING}`, 'i'),
    // "the layers": "show me the layers", "show the code layers".
    new RegExp(`\\b${VIEW} the (?:code )?(?:layers|layering)(?:\\s+(?:in|of)\\s+(?:the )?(?:code|codebase|repo|project|workspace|${PATH_LIKE}))?${ENDING}`, 'i'),
    // Code shown in the graph: "show me the unpartitioned files in the graph" (not the findings other rows own, nor a metric "in the graph").
    new RegExp(`^(?!.*\\b(?:duplicat\\w*|clones?|cycles?|dead code|unused)\\b).*\\b${VIEW} (?:the |all |my )?(?:[\\w-]+ ){0,3}?${CODE_NOUNS}\\b.{0,30}? in the (?:knowledge |dependency |code )?graph\\b`, 'i'),
];

export const KNOWLEDGE_PREFETCH_ROWS: readonly PrefetchRow[] = [
    {
        id: KNOWLEDGE_REVIEW_DIR, kind: 'answer', sideEffect: 'write', surfaces: WHERE, slash: '/review',
        patterns: [
            /\b(build|make|create|generate)\s+(me\s+)?(a\s+)?knowledge[- ]graph\s+(of|for|from)\b/i,
            /^\s*(please\s+)?(review|map)\s+(the\s+|this\s+)?(folder|directory|dir)\b/i,
            /^\s*(please\s+)?(review|map)\s+\.{1,2}[\\/]\S*/i,
        ],
        examples: ['review ./contracts', 'build a knowledge graph of docs/', 'map the specs folder', 'review this directory with BuilderForce'],
        budgetMs: REVIEW_BUDGET_MS, labelKey: `prefetch.action.${KNOWLEDGE_REVIEW_DIR}`,
    },
    {
        id: KNOWLEDGE_GRAPH, kind: 'answer', sideEffect: 'read', surfaces: WHERE, slash: '/graph',
        patterns: GRAPH_PATTERNS,
        examples: ['show me the graph', 'open the knowledge graph', 'show me the layers', 'show me the dependency graph', 'show me the knowledge graph of src/'],
        budgetMs: GRAPH_BUDGET_MS, labelKey: `prefetch.action.${KNOWLEDGE_GRAPH}`,
    },
];

/** The folder a review request names, workspace-relative; '' = the workspace itself. */
export function reviewTargetOf(request: string): string {
    const text = request.trim().replace(/^\/review\b/i, '').trim();
    const named = extractFocusPaths(text, 1)[0]
        ?? /^([\w.@-]+)$/.exec(text)?.[1]
        ?? /\b(?:of|for|from|review|map)\s+(?:the\s+)?([\w.@-]+)(?:\s+(?:folder|directory|dir))?\s*$/i.exec(text)?.[1];
    if (!named || /^(this|it|that|here|workspace|folder|directory|dir)$/i.test(named)) return '';
    const dir = named.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
    return dir === '.' ? '' : dir;
}

/** The graph refs a request names (`src:${rootId}::path`), first-mentioned first. */
export function graphFocusOf(request: string, rootId: string): string[] {
    return extractFocusPaths(request.replace(/^\s*\/graph\b/i, ''))
        .map((p) => srcRef(rootId, p.replace(/\\/g, '/').replace(/^\.?\/+/, '')));
}

/** One folder opened for review: the plan (no writes) and the review (only once confirmed). */
export interface KnowledgeReviewSession {
    rootId: string;
    title: string;
    /** The walk and its numbers; handed back to {@link review} so the confirmed run does not re-walk (§4.3). */
    plan(signal: AbortSignal): Promise<PlanDetail>;
    review(plan: PlanDetail, signal: AbortSignal): Promise<ReviewReport>;
}

export interface KnowledgeRowsHost {
    /** Opens `dir` (workspace-relative; '' = the workspace) for review; null when it is not a folder here. */
    openReview(dir: string): Promise<KnowledgeReviewSession | null>;
    /** The workspace's root id — what `/graph` opens on (a browser host reads its newest reviewed root). */
    rootId(): string | Promise<string>;
    /** How this host shows a graph: VS Code opens its panel; on-prem links to the web canvas. */
    showGraph(rootId: string, focus: string[]): Promise<{ text: string; chip?: PrefetchChip }>;
    /** ≈ price of one judged section, for the confirm chip's cost; absent ⇒ the chip states calls only. */
    callPrice?: ReviewCallPricePort;
}

export function knowledgePrefetchExecutors(host: KnowledgeRowsHost, now: () => number = Date.now): Record<string, PrefetchRunner> {
    /** The preview's plan, kept for the confirmed run of the SAME request (the plan is reused, §4.3). */
    const planned = new Map<string, { at: number; session: KnowledgeReviewSession; plan: PlanDetail }>();
    const fresh = (request: string) => {
        const hit = planned.get(request);
        return hit && now() - hit.at < PLAN_REUSE_MS ? hit : undefined;
    };
    const plan = async (request: string, signal: AbortSignal) => {
        const hit = fresh(request);
        if (hit) return hit;
        const session = await host.openReview(reviewTargetOf(request));
        if (!session || signal.aborted) return undefined;
        const entry = { at: now(), session, plan: await session.plan(signal) };
        planned.set(request, entry);
        return entry;
    };

    const review: PrefetchRunner = {
        async preview(request, signal) {
            const p = await plan(request, signal);
            return p ? planDetailLine(p.plan.plan, p.session.title) + await reviewCostSuffix(p.plan.plan.estimatedModelCalls, host.callPrice) : undefined;
        },
        async run(request, signal): Promise<PrefetchOutput | undefined> {
            const p = await plan(request, signal);
            planned.delete(request);
            if (!p) {
                const dir = reviewTargetOf(request);
                return { actionId: KNOWLEDGE_REVIEW_DIR, text: `There is no folder \`${dir || '.'}\` in this workspace to review.` };
            }
            const report = await p.session.review(p.plan, signal);
            const shown = await host.showGraph(p.session.rootId, []);
            return {
                actionId: KNOWLEDGE_REVIEW_DIR,
                text: reviewReportText(report, p.plan.plan, p.session.title),
                ...(shown.chip ? { chips: [shown.chip] } : {}),
                data: {
                    rootId: report.rootId, files: p.plan.plan.files, unchanged: p.plan.plan.unchanged, judged: report.judged,
                    unjudged: report.unjudged, factsWritten: report.factsWritten, aborted: report.aborted,
                },
            };
        },
    };

    const graph: PrefetchRunner = {
        async run(request) {
            const rootId = await host.rootId();
            const focus = graphFocusOf(request, rootId);
            const shown = await host.showGraph(rootId, focus);
            return {
                actionId: KNOWLEDGE_GRAPH,
                text: shown.text,
                ...(shown.chip ? { chips: [shown.chip] } : {}),
                data: { rootId, focus: focus.length },
            };
        },
    };

    return { [KNOWLEDGE_REVIEW_DIR]: review, [KNOWLEDGE_GRAPH]: graph };
}

/**
 * `/review <dir>` where the review runs in the knowledge VIEW (web, Rovr): the executor
 * cannot open a folder picker (no gesture), so it answers with the chip that opens the
 * view's review launcher. It writes nothing — the review's own confirm is the view's plan
 * chip — so a host may let it through without a second confirm.
 */
export function reviewInViewExecutor(): PrefetchRunner {
    return {
        async run(request) {
            const dir = reviewTargetOf(request);
            const named = dir ? ` \`${dir}\`` : '';
            return {
                actionId: KNOWLEDGE_REVIEW_DIR,
                text: `A folder${named} is reviewed in the knowledge view: choose it there, then confirm the plan it shows.`,
                chips: [{ labelKey: CHOOSE_FOLDER_LABEL_KEY, command: OPEN_KNOWLEDGE_REVIEW_COMMAND, args: { dir } }],
                data: { dir },
            };
        },
    };
}

/** A host PreFetch port's shape, as far as the knowledge rows touch it (`@builderforce/prefetch` `PrefetchPort`). */
export interface PortWithRows {
    registry: readonly PrefetchRow[];
    executors: Readonly<Record<string, PrefetchRunner>>;
}

/**
 * A host's port with the knowledge rows merged in: ONE registry (re-validated by the
 * host's `defineRegistry`, which this package may not import) and the executors over
 * `host`. The editor and on-prem both merge through this.
 */
export function withKnowledgeRows<P extends PortWithRows>(
    port: P,
    host: KnowledgeRowsHost,
    defineRegistry: (rows: readonly PrefetchRow[]) => readonly PrefetchRow[],
): P {
    return {
        ...port,
        registry: defineRegistry([...port.registry, ...KNOWLEDGE_PREFETCH_ROWS]),
        executors: { ...port.executors, ...knowledgePrefetchExecutors(host) },
    };
}

/** What a knowledge chip asks the host's view to do (web: the canvas surface; Rovr: its tab). */
export interface KnowledgeChipIntent {
    /** Open the view's review launcher (`/review`). */
    review: boolean;
    /** Refs to focus (`src:<root>::<path>`, `ent:…`, `fact:…`). */
    focus: string[];
    rootId?: string;
    /** The folder `/review` named, workspace-relative ('' = none). */
    dir?: string;
}

/** The knowledge intent of a PreFetch chip; undefined when the chip is not a knowledge one. */
export function knowledgeChipIntent(chip: { command: string; args?: Record<string, unknown> }): KnowledgeChipIntent | undefined {
    if (chip.command !== OPEN_KNOWLEDGE_GRAPH_COMMAND && chip.command !== OPEN_KNOWLEDGE_REVIEW_COMMAND) return undefined;
    const args = chip.args ?? {};
    const focus = Array.isArray(args.focus) ? args.focus.filter((f): f is string => typeof f === 'string') : [];
    return {
        review: chip.command === OPEN_KNOWLEDGE_REVIEW_COMMAND,
        focus,
        ...(typeof args.rootId === 'string' ? { rootId: args.rootId } : {}),
        ...(typeof args.dir === 'string' && args.dir ? { dir: args.dir } : {}),
    };
}
