/**
 * One component card of the System camera: the colour-channel dot, the mono name, "{files} · {owner}", the
 * stacked finding bar (its kinds only in the tooltip) and a thin bar for the ring channel. A metric that is
 * not set up draws nothing here: the legend says it once. Cards are equal width and never shrink below
 * CARD_MIN, so a narrow screen scrolls the row sideways instead of crushing the names.
 */

import type { CSSProperties } from 'react';
import { findingTitle } from '../../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { TYPE } from '../ui/type';
import { Bar } from '../drawers/ui';
import type { OverlayModel } from '../overlays';
import { counted } from '../plural';
import type { Station } from '../stations';
import type { KindCount } from '../tiers';

export const CARD_MIN = 132;

export const cardBox = (selected: boolean, dim: boolean, dashed = false): CSSProperties => ({
    flex: `1 1 0`, minWidth: CARD_MIN, display: 'flex', flexDirection: 'column', gap: 3, padding: selected ? '6px 8px' : '7px 9px', borderRadius: 8,
    cursor: 'pointer', font: 'inherit', color: cssVar('text'), textAlign: 'start', boxSizing: 'border-box',
    background: dashed ? cssVar('plane') : cssVar('panel'), opacity: dim ? 0.45 : 1,
    border: selected ? `2px solid ${cssVar('accent')}` : `1px ${dashed ? 'dashed' : 'solid'} ${cssVar('border')}`,
});

export const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };

export interface SystemCardProps {
    station: Station;
    labels: KnowledgeGraphLabels;
    overlay: OverlayModel;
    /** The station's findings by kind, and the colour of each kind. */
    found: readonly KindCount[];
    tones: ReadonlyMap<string, ThemeTone>;
    selected: boolean;
    dim: boolean;
    onSelect(id: string): void;
}

export function SystemCard({ station: st, labels, overlay, found, tones, selected, dim, onSelect }: SystemCardProps) {
    const s = labels.surface;
    const style = overlay.style(st);
    const total = found.reduce((n, k) => n + k.count, 0);
    const files = counted(labels, 'file', st.files);
    const ring = style.ring;
    const ringName = overlay.bindings.ring === 'cov' && st.covProvenance === 'heuristic' ? s.map.stats.reached : s.metricNames[overlay.bindings.ring];
    return (
        <button
            type="button" data-component={st.id} aria-pressed={selected} title={st.path ?? st.name}
            aria-label={fillTemplate(s.system.componentAria, { name: st.name, files, findings: counted(labels, 'finding', total) })}
            style={cardBox(selected, dim)} onClick={() => onSelect(st.id)}
        >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span aria-hidden="true" data-dot style={{ width: 10, height: 10, borderRadius: 999, flex: 'none', background: cssVar(style.tone) }} />
                <b style={{ ...ellipsis, ...TYPE.monoName }}>{st.name}</b>
            </span>
            <span style={{ ...ellipsis, ...TYPE.caption }}>
                {st.owner ? fillTemplate(s.system.metaOwner, { files, owner: st.owner }) : files}
                {st.copy !== undefined && <span data-copy={st.copy} title={st.copy}> · {s.systems.copyMark}</span>}
            </span>
            <span
                role="img" aria-label={s.system.antiBar} data-stack title={found.map((k) => `${findingTitle({ kind: k.kind }, labels)} · ${k.count}`).join('\n') || undefined}
                style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: cssVar('plane'), marginTop: 'auto' }}
            >
                {found.map((k) => <span key={k.kind} data-kind={k.kind} style={{ flex: k.count, background: cssVar(tones.get(k.kind) ?? 'unused') }} />)}
            </span>
            {ring && <Bar frac={ring.frac} tone={ring.tone} label={ringName} height={3} />}
        </button>
    );
}
