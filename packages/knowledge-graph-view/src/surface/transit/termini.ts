/**
 * Where a line ends, named: the glyph (a tank for a data store, a globe for an outside
 * service, a cross for a dead end, a ticked box for a dead end somebody already reported) and
 * the name, derived from what the graph already says about the last station: its name, the
 * paths of its files and their `imports` badge. The rules are data; a station no rule names
 * keeps the generic words ("Data store", "External service"). Several lines that end at the
 * same station share one glyph. Pure.
 */

import type { ExternalServiceId, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex, pathOf } from '../../graphModel';
import type { KnowledgeGraphLabels } from '../../labels';
import type { Line } from '../lines';
import type { Station } from '../stations';

export type TerminusGlyph = 'tank' | 'globe' | 'cross' | 'box';
/** The ids the code pack's `externals` badge uses: memory's list, so the writer and this table cannot drift apart. */
export type TerminusName = ExternalServiceId;

interface Rule { glyph: 'tank' | 'globe'; /** Tried against the station's name and file paths when no `externals` badge names it. */ test: RegExp }

const RULE_BY_ID = {
    llm: { glyph: 'globe', test: /openai|anthropic|\bllm\b|completion|gemini|mistral|model-?provider/i },
    github: { glyph: 'globe', test: /github|octokit/i },
    stripe: { glyph: 'globe', test: /stripe|payment/i },
    slack: { glyph: 'globe', test: /slack/i },
    mail: { glyph: 'globe', test: /smtp|sendgrid|resend|mailgun|\bmail/i },
    oauth: { glyph: 'globe', test: /oauth|\bsso\b|saml/i },
    postgres: { glyph: 'tank', test: /postgres|\bpg\b|neon|drizzle|prisma/i },
    kv: { glyph: 'tank', test: /\bkv\b|\br2\b|redis|\bs3\b|blob|bucket|storage|cache/i },
} as const satisfies Record<ExternalServiceId, Rule>;

/** First match wins, so the specific services come before the generic ones. */
export const TERMINUS_RULES: ReadonlyArray<Rule & { name: TerminusName }> =
    (['llm', 'github', 'stripe', 'slack', 'mail', 'oauth', 'postgres', 'kv'] as const satisfies readonly ExternalServiceId[])
        .map((name) => ({ name, ...RULE_BY_ID[name] }));

export interface TerminusInfo {
    stationId: string;
    /** The lines that end here. */
    lineIds: string[];
    glyph: TerminusGlyph;
    /** The kind the line model gave it. */
    kind: Line['terminus']['kind'];
    /** A rule named it; null = the generic words for `kind`. */
    name: TerminusName | null;
    /** A dead end nobody has reported yet. */
    deadEnd: boolean;
    reported: boolean;
}

/** The words a rule is tried against: the station name, its files' paths and their `imports` badge. */
export function terminusHints(station: Pick<Station, 'name' | 'refs'>, graph: Pick<KnowledgeGraph, 'nodes'> | null): string[] {
    const index = graph ? nodeIndex(graph) : new Map();
    const hints = [station.name];
    for (const ref of station.refs.slice(0, 40)) {
        const path = pathOf(ref);
        if (path) hints.push(path);
        const imports = index.get(ref)?.badges?.imports;
        if (imports !== undefined) hints.push(String(imports));
    }
    return hints;
}

/**
 * The service ids the station's files import: their `externals` badge (written by the code pack
 * from the known-SDK table in agent-tools' `externalServices.ts`, whose ids are the rule names
 * above). Outline-only files do not carry it (memory's OUTLINE_BADGE_KEYS omits it).
 */
export function terminusExternals(station: Pick<Station, 'refs'>, graph: Pick<KnowledgeGraph, 'nodes'> | null): string[] {
    const index = graph ? nodeIndex(graph) : new Map();
    const ids = new Set<string>();
    for (const ref of station.refs) {
        const badge = index.get(ref)?.badges?.externals;
        if (badge !== undefined) for (const id of String(badge).split(',')) if (id.trim()) ids.add(id.trim());
    }
    return [...ids];
}

export function terminusFor(kind: Line['terminus']['kind'], station: Pick<Station, 'findingIds'> | undefined, hints: readonly string[], externals: readonly string[] = []): Omit<TerminusInfo, 'stationId' | 'lineIds'> {
    if (kind === 'end') {
        const reported = (station?.findingIds.length ?? 0) > 0;
        return { glyph: reported ? 'box' : 'cross', kind, name: null, deadEnd: !reported, reported };
    }
    // Only a rule of the line's own kind can name it: a data store is a tank, an outside service a globe.
    // What the files import beats what their names suggest.
    const glyph = kind === 'data' ? 'tank' : 'globe';
    const rules = TERMINUS_RULES.filter((r) => r.glyph === glyph);
    const text = hints.join(' ');
    const rule = rules.find((r) => externals.includes(r.name)) ?? rules.find((r) => r.test.test(text));
    return { glyph, kind, name: rule?.name ?? null, deadEnd: false, reported: false };
}

/** One entry per terminus station, in the order the lines come. */
export function groupTermini(lines: readonly Line[], byId: ReadonlyMap<string, Station>, graph: Pick<KnowledgeGraph, 'nodes'> | null): TerminusInfo[] {
    const out = new Map<string, TerminusInfo>();
    for (const line of lines) {
        const id = line.terminus.stationId;
        const have = out.get(id);
        if (have) { have.lineIds.push(line.id); continue; }
        const station = byId.get(id);
        out.set(id, { stationId: id, lineIds: [line.id], ...terminusFor(line.terminus.kind, station, station ? terminusHints(station, graph) : [], station ? terminusExternals(station, graph) : []) });
    }
    return [...out.values()];
}

/** The words under the glyph. */
export function terminusText(info: TerminusInfo, labels: KnowledgeGraphLabels): string {
    const s = labels.surface;
    if (info.deadEnd) return s.map.deadEnd;
    if (info.reported) return s.map.reported;
    return info.name ? s.map.names[info.name] : s.terminus[info.kind];
}
