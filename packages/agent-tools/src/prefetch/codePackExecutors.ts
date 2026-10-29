/**
 * `dup.check`, `deps.cycles`, `deadcode.check` and `arch.boundaries` — answered through the CODE PACK, so the
 * summary counts exactly the findings the knowledge-graph view shows (PRD 38 §4.5):
 *
 *   the existing runner (`runCodeAnalysis`: dependency-cruiser, jscpd, knip, with the
 *   workspace's layers) → the code pack's analyzers (`codeAnalyzers`) → memory's
 *   `buildGraph(...).findings` over `knowledgePacks()`.
 *
 * One analysis serves every action while the tree is unchanged (cached per sha, see
 * `workspaceAnalysis.ts`), and a finding list ends with an **Open in graph** chip focused on its files. A run whose
 * relevant analyzer FAILED answers nothing — missing output is never reported as clean.
 */

import { buildGraph, compareStr, MAX_NODES_CAP, partitionOf, partitionSeverity, pathOfRef, verdictOf, type Finding, type PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { CODE_PARTITIONS_FILE, loadCodePartitions } from '../knowledge/codePack.js';
import { codeAnalyzers } from '../knowledge/codeAnalyzers.js';
import { knowledgePacks } from '../knowledge/knowledgePacks.js';
import { analyseWorkspace, forgetWorkspaceAnalyses } from '../knowledge/workspaceAnalysis.js';
import type { PrefetchExecHost, PrefetchRunner } from './contract.js';
import { PREFETCH_LIST_CAP } from './exec.js';
import { CHIP_FOCUS_MAX, OPEN_IN_GRAPH_LABEL_KEY, OPEN_KNOWLEDGE_GRAPH_COMMAND, openInGraphChip } from './graphChip.js';

export { OPEN_IN_GRAPH_LABEL_KEY, OPEN_KNOWLEDGE_GRAPH_COMMAND };

/** The workspace's layers: `.builderforce/partitions.json` when valid, else `CODE_LAYERS`. */
export async function readPartitions(host: Pick<PrefetchExecHost, 'caps'>): Promise<PartitionRegistry> {
    const file = await host.caps.repoRead?.readFile(CODE_PARTITIONS_FILE).catch(() => undefined);
    try {
        return loadCodePartitions(file?.ok ? file.content : undefined);
    } catch {
        return loadCodePartitions();
    }
}

interface Analysis { snapshot: CodeAnalysisSnapshot; findings: Finding[]; partitions: PartitionRegistry }

async function analyse(host: PrefetchExecHost, signal: AbortSignal): Promise<Analysis | null> {
    const partitions = await readPartitions(host);
    const { snapshot, repoGraph } = await analyseWorkspace(
        { caps: host.caps, rootId: host.rootId, partitions, ...(host.repoGraph ? { repoGraph: host.repoGraph } : {}) },
        signal,
    );
    if (!snapshot || signal.aborted) return null;
    const packs = knowledgePacks({ analyzers: codeAnalyzers({ run: async () => ({ analysis: snapshot, repoGraph }) }), partitions });
    const extracted = await packs[0]!.analyzers!.analyse(host.rootId, signal);
    const graph = buildGraph({ rootId: host.rootId, extracted, facts: [], relations: [], packs }, { maxNodes: MAX_NODES_CAP });
    return { snapshot, findings: graph.findings, partitions };
}

/**
 * The code pack's findings for this workspace, shared by the code actions. The analyzers
 * run once per tree (`analyseWorkspace` caches per sha); a failed or stopped run is null.
 */
export function codePackFindings(host: PrefetchExecHost, signal: AbortSignal): Promise<Analysis | null> {
    return analyse(host, signal).catch(() => null);
}

/** Forget cached analyses (tests; a host that knows the tree changed under the same sha). */
export function forgetCodePackFindings(): void {
    forgetWorkspaceAnalyses();
}

interface CodeAction {
    id: string;
    /** The analyzer whose output this action reads — a failed one means no answer. */
    analyzer: 'jscpd' | 'dependency-cruiser' | 'knip';
    kinds: readonly string[];
    title: (n: number) => string;
    none: string;
    /** The findings this action counts, from the code pack's of its kinds. Default: all of them. */
    select?(findings: Finding[], snapshot: CodeAnalysisSnapshot, partitions: PartitionRegistry): Finding[];
    /** The action answers for the focus files when the person is working in some. */
    focusScoped?: boolean;
}

/**
 * A layer violation is an IMPORT that crosses layers the wrong way: an edge dependency-cruiser
 * drew (`snapshot.edges`, the real from → to) whose layers the registry does not allow
 * (`upward` or `skips`). The graph's partition verdict is also given to the repo map's
 * `references` and to clone pairs, and a finding's `nodes` are sorted (not in import
 * direction) with one finding per pair — memory keeps ONE of them, whichever edge it saw
 * first, so its figures may be the other edge's. So a finding is only a candidate: it counts
 * when an import between its two files is itself a violation, judged here in the import's own
 * direction, and it is reported with that import's verdict, severity and layers.
 */
function importViolations(findings: Finding[], snapshot: CodeAnalysisSnapshot, partitions: PartitionRegistry): Finding[] {
    const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
    const violating = new Map<string, { verdict: 'upward' | 'skips'; from: string; to: string }>();
    for (const e of snapshot.edges) {
        if (e.from === e.to) continue;
        const from = partitionOf(e.from, partitions);
        const to = partitionOf(e.to, partitions);
        const verdict = verdictOf(from, to, partitions);
        if (verdict !== 'upward' && verdict !== 'skips') continue;
        // Imports both ways on one pair: the upward one (an error) wins over a skip (a warning), whichever edge comes first.
        const key = pairKey(e.from, e.to);
        if (violating.get(key)?.verdict === 'upward') continue;
        violating.set(key, { verdict, from: from ?? '', to: to ?? '' });
    }
    const rejudged = findings.flatMap((f): Finding[] => {
        const [a, b] = f.nodes.map((ref) => pathOfRef(ref));
        const own = a !== undefined && b !== undefined ? violating.get(pairKey(a, b)) : undefined;
        if (!own) return [];
        return [{ ...f, severity: partitionSeverity(own.verdict), params: { ...f.params, verdict: own.verdict, from: own.from, to: own.to, kind: 'references' } }];
    });
    // Memory lists findings error → warn → info, then by id; a re-judged severity must not leave an error below the list cap.
    return rejudged.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || compareStr(x.id, y.id));
}

const SEVERITY_RANK: Record<Finding['severity'], number> = { error: 0, warn: 1, info: 2 };

const CODE_ACTIONS: readonly CodeAction[] = [
    { id: 'dup.check', analyzer: 'jscpd', kinds: ['clone-group', 'near-duplicate'], title: (n) => `${n} duplicate-code group(s)`, none: 'No duplicate code found (jscpd).' },
    { id: 'deps.cycles', analyzer: 'dependency-cruiser', kinds: ['cycle'], title: (n) => `${n} import cycle(s)`, none: 'No import cycles found (dependency-cruiser).' },
    { id: 'arch.boundaries', analyzer: 'dependency-cruiser', kinds: ['partition-violation'], select: importViolations, focusScoped: true, title: (n) => `${n} layer-boundary violation(s)`, none: 'No layer-boundary violations found (dependency-cruiser, the workspace layers).' },
    { id: 'deadcode.check', analyzer: 'knip', kinds: ['unused-file', 'unused-export', 'unused-dependency'], title: (n) => `${n} unused-code finding(s)`, none: 'No unused files, exports or dependencies found (knip).' },
];

/** One finding as a line: its kind, its files, and the figures it carries. */
function findingLine(f: Finding): string {
    const files = f.nodes.map((ref) => pathOfRef(ref) ?? ref);
    const shown = files.slice(0, 4).map((p) => `\`${p}\``).join(', ');
    const more = files.length > 4 ? ` +${files.length - 4} more` : '';
    const params = Object.entries(f.params).filter(([k]) => k !== 'group').map(([k, v]) => `${k} ${v}`).join(', ');
    return `- **${f.kind}** (${f.severity}) ${shown}${more}${params ? ` — ${params}` : ''}`;
}

/** The root-relative files the person is working in, as the findings' paths spell them. */
function focusSet(host: PrefetchExecHost, analysed: readonly string[]): Set<string> {
    const known = new Set(analysed);
    // Only files the analysis saw can scope an answer: none of them ⇒ the whole workspace.
    return new Set((host.focusFiles?.() ?? []).map((p) => p.split('\\').join('/').replace(/^\.\//, '')).filter((p) => known.has(p)));
}

function codeActionRunner(host: PrefetchExecHost, action: CodeAction): PrefetchRunner {
    return {
        async run(_request, signal) {
            const analysis = await codePackFindings(host, signal);
            if (!analysis || signal.aborted) return undefined;
            const tool = analysis.snapshot.tools.find((t) => t.name === action.analyzer);
            if (!tool || tool.status !== 'complete') return undefined;
            const ofKind = analysis.findings.filter((f) => action.kinds.includes(f.kind));
            let findings = action.select ? action.select(ofKind, analysis.snapshot, analysis.partitions) : ofKind;
            const focus = action.focusScoped ? focusSet(host, analysis.snapshot.nodes) : new Set<string>();
            if (focus.size > 0) findings = findings.filter((f) => f.nodes.some((ref) => focus.has(pathOfRef(ref) ?? '')));
            const scope = focus.size > 0 ? ` among the ${focus.size} file(s) you are working in` : '';
            const data = { findings: findings.length, files: analysis.snapshot.nodes.length, snapshotId: analysis.snapshot.id };
            if (findings.length === 0) return { actionId: action.id, text: `${action.none.replace(/\.$/, '')}${scope}.`, data };
            const refs = [...new Set(findings.flatMap((f) => f.nodes))].slice(0, CHIP_FOCUS_MAX);
            const lines = findings.slice(0, PREFETCH_LIST_CAP).map(findingLine);
            const rest = findings.length > PREFETCH_LIST_CAP ? `\n\n…and ${findings.length - PREFETCH_LIST_CAP} more in the knowledge graph.` : '';
            return {
                actionId: action.id,
                text: `**${action.title(findings.length)}**${scope || ` across ${analysis.snapshot.nodes.length} analysed file(s)`}:\n\n${lines.join('\n')}${rest}`,
                chips: [openInGraphChip({ rootId: host.rootId, focus: refs })],
                data,
            };
        },
    };
}

/** The code-pack executors, by action id. */
export function codePackExecutors(host: PrefetchExecHost): Record<string, PrefetchRunner> {
    return Object.fromEntries(CODE_ACTIONS.map((a) => [a.id, codeActionRunner(host, a)]));
}
