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

import { buildGraph, MAX_NODES_CAP, pathOfRef, type Finding, type PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { CODE_PARTITIONS_FILE, loadCodePartitions } from '../knowledge/codePack.js';
import { codeAnalyzers } from '../knowledge/codeAnalyzers.js';
import { knowledgePacks } from '../knowledge/knowledgePacks.js';
import { analyseWorkspace, forgetWorkspaceAnalyses } from '../knowledge/workspaceAnalysis.js';
import type { PrefetchChip, PrefetchExecHost, PrefetchRunner } from './contract.js';
import { PREFETCH_LIST_CAP } from './exec.js';

/** The command that opens the knowledge-graph view (registered by the editor's graph view). */
export const OPEN_KNOWLEDGE_GRAPH_COMMAND = 'builderforce.openKnowledgeGraph';
/** The chip's label key in every host catalog. */
export const OPEN_IN_GRAPH_LABEL_KEY = 'prefetch.chip.openInGraph';
/** The most refs a chip focuses. */
const CHIP_FOCUS_MAX = 50;

/** The workspace's layers: `.builderforce/partitions.json` when valid, else `CODE_LAYERS`. */
export async function readPartitions(host: Pick<PrefetchExecHost, 'caps'>): Promise<PartitionRegistry> {
    const file = await host.caps.repoRead?.readFile(CODE_PARTITIONS_FILE).catch(() => undefined);
    try {
        return loadCodePartitions(file?.ok ? file.content : undefined);
    } catch {
        return loadCodePartitions();
    }
}

interface Analysis { snapshot: CodeAnalysisSnapshot; findings: Finding[] }

async function analyse(host: PrefetchExecHost, signal: AbortSignal): Promise<Analysis | null> {
    const partitions = await readPartitions(host);
    const { snapshot, repoGraph } = await analyseWorkspace(
        { caps: host.caps, partitions, ...(host.repoGraph ? { repoGraph: host.repoGraph } : {}) },
        signal,
    );
    if (!snapshot || signal.aborted) return null;
    const packs = knowledgePacks({ analyzers: codeAnalyzers({ run: async () => ({ analysis: snapshot, repoGraph }) }), partitions });
    const extracted = await packs[0]!.analyzers!.analyse(host.rootId, signal);
    const graph = buildGraph({ rootId: host.rootId, extracted, facts: [], relations: [], packs }, { maxNodes: MAX_NODES_CAP });
    return { snapshot, findings: graph.findings };
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
}

const CODE_ACTIONS: readonly CodeAction[] = [
    { id: 'dup.check', analyzer: 'jscpd', kinds: ['clone-group', 'near-duplicate'], title: (n) => `${n} duplicate-code group(s)`, none: 'No duplicate code found (jscpd).' },
    { id: 'deps.cycles', analyzer: 'dependency-cruiser', kinds: ['cycle'], title: (n) => `${n} import cycle(s)`, none: 'No import cycles found (dependency-cruiser).' },
    { id: 'arch.boundaries', analyzer: 'dependency-cruiser', kinds: ['partition-violation'], title: (n) => `${n} layer-boundary violation(s)`, none: 'No layer-boundary violations found (dependency-cruiser, the workspace layers).' },
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

function codeActionRunner(host: PrefetchExecHost, action: CodeAction): PrefetchRunner {
    return {
        async run(_request, signal) {
            const analysis = await codePackFindings(host, signal);
            if (!analysis || signal.aborted) return undefined;
            const tool = analysis.snapshot.tools.find((t) => t.name === action.analyzer);
            if (!tool || tool.status !== 'complete') return undefined;
            const findings = analysis.findings.filter((f) => action.kinds.includes(f.kind));
            const data = { findings: findings.length, files: analysis.snapshot.nodes.length, snapshotId: analysis.snapshot.id };
            if (findings.length === 0) return { actionId: action.id, text: action.none, data };
            const refs = [...new Set(findings.flatMap((f) => f.nodes))].slice(0, CHIP_FOCUS_MAX);
            const chip: PrefetchChip = { labelKey: OPEN_IN_GRAPH_LABEL_KEY, command: OPEN_KNOWLEDGE_GRAPH_COMMAND, args: { focus: refs } };
            const lines = findings.slice(0, PREFETCH_LIST_CAP).map(findingLine);
            const rest = findings.length > PREFETCH_LIST_CAP ? `\n\n…and ${findings.length - PREFETCH_LIST_CAP} more in the knowledge graph.` : '';
            return {
                actionId: action.id,
                text: `**${action.title(findings.length)}** across ${analysis.snapshot.nodes.length} analysed file(s):\n\n${lines.join('\n')}${rest}`,
                chips: [chip],
                data,
            };
        },
    };
}

/** The code-pack executors, by action id. */
export function codePackExecutors(host: PrefetchExecHost): Record<string, PrefetchRunner> {
    return Object.fromEntries(CODE_ACTIONS.map((a) => [a.id, codeActionRunner(host, a)]));
}
