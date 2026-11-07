/**
 * The surface's half of the copied diagnostics: where the map's files came from, which per-file
 * data the graph carries (and why a channel is empty), the layers, the lines, the scope, what the
 * sync counts mean, and how the three findings counts relate. PURE and English like
 * `graphDiagnostics.ts`; every fact is read from the same modules the UI reads
 * (`dataCoverage`, `buildTiers`, `hasNoLocalSnapshot`), never recomputed here.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS } from './labels';
import { counted } from './surface/plural';
import { COVERAGE_KEYS, type DataCoverage, type GapReason } from './surface/dataCoverage';
import type { LinesModel } from './surface/lines';
import type { StationModel } from './surface/stations';
import { hasNoLocalSnapshot } from './surface/syncPill';
import { buildTiers } from './surface/tiers';
import type { SyncStatus } from './types';

export interface SurfaceDiagnosticsInput {
    graph: KnowledgeGraph;
    stations: StationModel;
    lines: LinesModel;
    coverage: DataCoverage | null;
    /** The line or station the Act panel is scoped to; null = the whole graph. */
    scopeName: string | null;
    scope: ReadonlySet<string> | null;
    /** Findings the lens shows, and the ones the Findings list shows (lens and scope). */
    lensFindings: number;
    listedFindings: number;
    /** The Fix queue's counts, as the Act panel prints them. */
    queue: { open: number; shown: number; repo: number };
    sync: SyncStatus | null;
    /** When the folder was last reviewed (ISO), if the host knows. */
    lastReviewedAt?: string | undefined;
}

const REASON: Record<GapReason, string> = {
    'no-outline': 'no outline: the server sent only the cut graph',
    'no-badges': 'no file carries badges: the review predates the per-file extractor, re-review',
    'not-collected': 'not collected (for example no coverage file was found)',
};

const pct = (n: number, of: number): string => (of > 0 ? `${Math.round((n / of) * 100)}%` : 'n/a');

function mapSourceLines(c: DataCoverage | null, stations: number): string[] {
    if (!c) return [];
    const s = c.source;
    if (s.kind === 'outline') return [`map source: outline (files=${s.files}, stations=${stations}, capped=${s.capped ? 'yes' : 'no'})`];
    if (s.kind === 'cut') return [`map source: cut graph — the server sent no outline (server older than the outline release); the map shows ${s.files} of ${s.sources} files`];
    return [`map source: full graph (files=${s.files})`];
}

function coverageLines(c: DataCoverage | null): string[] {
    if (!c) return [];
    return ['data coverage (files carrying each per-file badge):', ...COVERAGE_KEYS.map((key) => {
        const ch = c.channels[key];
        return `  ${key}: ${ch.have}/${ch.of} files${ch.reason ? ` — ${REASON[ch.reason]}` : ''}`;
    })];
}

function syncLines(sync: SyncStatus | null): string[] {
    if (!sync) return ['sync: the host reports no status'];
    const out = [`sync: local=${sync.local.files} server=${sync.server ? sync.server.files : 'n/a'} files`];
    if (hasNoLocalSnapshot(sync)) out.push('sync meaning: "0 here" = no local snapshot; this folder is reviewed on the server only (linked project)');
    else if (sync.server && sync.server.files !== sync.local.files) out.push('sync meaning: the counts here and on the server differ (out of sync)');
    return out;
}

export function surfaceDiagnosticLines(i: SurfaceDiagnosticsInput): string[] {
    const { stations: model, lines: lm, coverage: c } = i;
    const out: string[] = [];
    out.push(...mapSourceLines(c, model.stations.length));
    out.push(...coverageLines(c));

    if (c) out.push(`partitions: files without a partition=${c.noPartition}/${c.files} (${pct(c.noPartition, c.files)})`);
    const tiers = buildTiers(model.stations);
    out.push(`stations by tier: ${tiers.map((t) => `${t.layer}=${t.stations.length}`).join(', ') || 'none'}`);

    const entries = model.stations.filter((s) => s.entry).length;
    out.push(`lines: drawn=${lm.lines.length} · entry points found=${entries}${lm.omitted ? ` · not drawn=${lm.omitted}` : ''}`);
    for (const l of lm.lines) out.push(`  line ${l.name}: stops=${l.stops.length}`);
    if (lm.lines.length <= 1) out.push(`lines note: ${lm.lines.length} line because ${entries === 0 ? 'no entry point was found' : `${counted(DEFAULT_KNOWLEDGE_GRAPH_LABELS, 'entryPoint', entries)} found`}${c?.source.kind === 'cut' ? ' (in the cut graph\'s files only)' : ''}`);

    const inScope = i.scope ? [...i.scope].reduce((n, id) => n + (model.byId.get(id)?.files ?? 0), 0) : i.graph.nodes.length;
    out.push(`scope: ${i.scopeName ?? 'whole graph'} · stations=${i.scope ? i.scope.size : model.stations.length} · ${i.scope ? 'files' : 'nodes'} in scope=${inScope}`);

    out.push(...syncLines(i.sync));

    const graphCount = i.graph.findings.length;
    out.push(`findings: in the graph=${graphCount} · in this lens=${i.lensFindings} · listed (lens and scope)=${i.listedFindings} · fix queue=${i.queue.open} open of ${i.queue.shown} shown · ${i.queue.repo} in the repo`);
    if (graphCount !== i.listedFindings) {
        out.push('findings note: Insights counts every finding in the graph; the Findings list counts only those in the current lens and scope; the Fix queue counts open ones of the listed, then the repo total');
    }

    out.push(`graph digest: ${i.graph.scope.digest}`);
    out.push(`reviewedAt: ${i.lastReviewedAt ?? 'unknown'} · graph/extractor version: not carried by the graph`);
    return out;
}
