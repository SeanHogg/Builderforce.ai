/**
 * The tag at the right of a stop row: the station's first finding as "{pin number} · {title}", else
 * its coverage as "62%" (a static reach as "62% reached"), else nothing. Never a bare file count.
 * The pin number is the finding's place in the list the Act rail shows, so the two agree.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { findingTitle } from '../../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { ThemeTone } from '../../scene/themeColors';
import { pinNumbers } from '../pinNumbers';
import type { Station } from '../stations';

export interface StopTag { text: string; tone: ThemeTone; kind: 'finding' | 'coverage' | 'reached' }

const SEVERITY_TONE = { error: 'violation', warn: 'cycle', info: 'muted' } as const satisfies Record<Finding['severity'], ThemeTone>;
/** Below this a station reads as thin on tests (the same line the "untested" question draws). */
const THIN = 0.5;

/** station id → its first finding in `findings`, with that finding's 1-based place in the list. */
export function firstFindings(stations: Iterable<Station>, findings: readonly Finding[]): Map<string, { n: number; finding: Finding }> {
    const numbers = pinNumbers(findings);
    const place = new Map(findings.map((f) => [f.id, { n: numbers.get(f.id)!, finding: f }] as const));
    const out = new Map<string, { n: number; finding: Finding }>();
    for (const st of stations) {
        const first = st.findingIds.flatMap((id) => place.get(id) ?? []).sort((a, b) => a.n - b.n)[0];
        if (first) out.set(st.id, first);
    }
    return out;
}

export function stopTag(st: Station, first: { n: number; finding: Finding } | undefined, labels: KnowledgeGraphLabels): StopTag | null {
    if (first) {
        return { kind: 'finding', tone: SEVERITY_TONE[first.finding.severity], text: fillTemplate(labels.surface.rail.pinTag, { n: first.n, title: findingTitle(first.finding, labels) }) };
    }
    if (st.cov === undefined) return null;
    const percent = Math.round(st.cov * 100), tone: ThemeTone = st.cov < THIN ? 'cycle' : 'muted';
    return st.covProvenance === 'heuristic'
        ? { kind: 'reached', tone, text: fillTemplate(labels.surface.rail.reachedTag, { percent }) }
        : { kind: 'coverage', tone, text: `${percent}%` };
}
