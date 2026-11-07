/**
 * What the station card says and offers: four stats, the station's open issues by name, and
 * which of its actions apply (go inside, unfold, who calls, API contract, patterns). Pure, so
 * the card only draws it. A stat whose data was never collected reads "—", never zero.
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { findingTitle } from '../../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { counted } from '../plural';
import type { ThemeTone } from '../../scene/themeColors';
import { SEVERITY_TONES } from '../overlays';
import type { Station } from '../stations';
import type { EnterCheck } from './useDrill';

export const MAX_ISSUES = 3;
export const NO_DATA = '—';

export interface CardStat {
    key: 'issues' | 'complexity' | 'coverage' | 'usage';
    label: string;
    value: string;
    tone: ThemeTone | null;
    /** What the number means, as a tooltip. */
    title?: string;
}

export interface CardModel {
    name: string;
    meta: string;
    stats: CardStat[];
    issues: string[];
    issueMore: number;
    enter: EnterCheck;
    /** How many satellites Unfold would draw (0 = no button). */
    unfold: number;
    unfolded: boolean;
    hasApi: boolean;
    hasPatterns: boolean;
    leaf: boolean;
}

export interface CardInput {
    station: Station;
    labels: KnowledgeGraphLabels;
    layerName: string;
    findings: ReadonlyMap<string, Finding>;
    index: ReadonlyMap<string, KNode>;
    enter: EnterCheck;
    satellites: number;
    unfolded: boolean;
    leaf: boolean;
    /** Every station, to rank this one's importance; absent ⇒ rank among itself. */
    stations?: readonly Station[] | undefined;
}

const ANTI_WORDS = ['none', 'low', 'medium', 'high', 'severe'] as const;
/** The anti-pattern level (1 to 5) as a word. */
export const antiWord = (level: number): (typeof ANTI_WORDS)[number] => ANTI_WORDS[Math.min(5, Math.max(1, Math.round(level))) - 1]!;
/** 1-based importance rank by `use` (ties share the better rank), and how many stations were ranked. */
export function importanceRank(s: Station, stations: readonly Station[] | undefined): { rank: number; total: number } {
    const all = stations ?? [];
    const rank = 1 + all.filter((x) => x.id !== s.id && x.use > s.use).length;
    return { rank, total: Math.max(all.length, rank, 1) };
}

const percent = (f: number): string => `${Math.round(f * 100)}%`;
const level = (l: number): ThemeTone => SEVERITY_TONES[Math.min(5, Math.max(1, Math.round(l))) - 1]!;

export function buildCard(i: CardInput): CardModel {
    const { station: s, labels } = i;
    const t = labels.surface.map.stats, w = labels.surface.map.statWords;
    const { rank, total } = importanceRank(s, i.stations);
    const stats: CardStat[] = [
        { key: 'issues', label: t.issues, value: w.anti[antiWord(s.anti)], tone: s.findingIds.length > 0 ? level(s.anti) : null, title: counted(labels, 'antiTip', s.findingIds.length) },
        { key: 'complexity', label: t.complexity, value: s.cx === undefined ? NO_DATA : fillTemplate(labels.surface.levelOf5, { level: s.cx }), tone: s.cx === undefined ? null : level(s.cx) },
        { key: 'coverage', label: s.covProvenance === 'heuristic' ? t.reached : t.coverage, value: s.cov === undefined ? NO_DATA : percent(s.cov), tone: s.cov === undefined ? null : level(5 - Math.round(s.cov * 4)) },
        { key: 'usage', label: t.usage, value: fillTemplate(w.importance, { rank, total }), tone: null, title: w.importanceTip },
    ];
    const titles = s.findingIds.flatMap((id) => i.findings.get(id) ?? []).map((f) => findingTitle(f, labels));
    return {
        name: s.name,
        meta: fillTemplate(labels.surface.stationMeta, { files: counted(labels, 'file', s.files), layer: i.layerName }),
        stats,
        issues: titles.slice(0, MAX_ISSUES),
        issueMore: Math.max(0, titles.length - MAX_ISSUES),
        enter: i.enter, unfold: i.satellites, unfolded: i.unfolded,
        hasApi: s.refs.some((ref) => i.index.get(ref)?.badges?.routes !== undefined),
        hasPatterns: s.patterns.length > 0,
        leaf: i.leaf,
    };
}
