/**
 * The link key: one row per kind of line the map draws between marks (the open method's calls, then the associations a
 * class band shows), each as a short sample of the line itself. The tone and dash come from the placement's own table
 * (`ASSOCIATION_STYLE`, `CALL_LINK_STYLE`), so the key cannot drift from what is drawn. Tokens only.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { kindLabel } from '../names';
import { ASSOCIATION_LINK_KINDS, ASSOCIATION_STYLE, CALL_LINK_STYLE, type AssociationLinkKind } from '../compute/tasks/placement/associations';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { DASH_PATTERNS } from '../stage/types';
import { list } from '../styles';
import { TYPE } from './ui/type';

interface LinkRow { kind: string; label: string; tone: ThemeTone; dash: number }

/** The legend word of each association kind (`uses` is read as "uses / reads"). */
const ASSOCIATION_LABEL: Readonly<Record<AssociationLinkKind, string>> = {
    extends: 'linkExtends', implements: 'linkImplements', composes: 'linkComposes', uses: 'linkReads',
};

export const LINK_LEGEND: readonly LinkRow[] = [
    { kind: 'calls', label: 'linkCalls', ...CALL_LINK_STYLE },
    ...ASSOCIATION_LINK_KINDS.map((kind) => ({ kind, label: ASSOCIATION_LABEL[kind], ...ASSOCIATION_STYLE[kind] })),
];

const SAMPLE_W = 24;
const SAMPLE_H = 6;

export function LinkLegend({ labels }: { labels: Pick<KnowledgeGraphLabels, 'legend'> }) {
    const title = kindLabel(labels, 'linksTitle');
    return (
        <section aria-label={title} data-testid="kg-link-legend" style={{ display: 'grid', gap: 4 }}>
            <span style={TYPE.meta}>{title}</span>
            <ul style={{ ...list, display: 'grid', gap: 2 }}>
                {LINK_LEGEND.map((row) => {
                    const [on, off] = DASH_PATTERNS[row.dash] ?? DASH_PATTERNS[0]!;
                    return (
                        <li key={row.kind} data-link={row.kind} style={{ display: 'flex', alignItems: 'center', gap: 6, ...TYPE.meta }}>
                            <svg width={SAMPLE_W} height={SAMPLE_H} aria-hidden="true">
                                <line x1={0} y1={SAMPLE_H / 2} x2={SAMPLE_W} y2={SAMPLE_H / 2} stroke={cssVar(row.tone)} strokeWidth={1.5} {...(on > 0 ? { strokeDasharray: `${on} ${off}` } : {})} />
                            </svg>
                            <span>{kindLabel(labels, row.label)}</span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
