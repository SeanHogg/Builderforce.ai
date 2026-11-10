/**
 * One tier of the System camera: its label (coloured per layer, from the shared BAND_TONE), the cards in a
 * row of equal width (the first MAX_PER_TIER, then a "+N more" card that opens the List on this layer) and
 * the sentence that says how the tier reaches the next. At phone width the label sits above the cards and
 * the cards scroll sideways.
 */

import type { CSSProperties } from 'react';
import { fillTemplate } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../ui/type';
import { BAND_TONE } from '../bands';
import { SystemCard, cardBox } from './SystemCard';
import type { TierRow } from './systemModel';
import type { SystemCardProps } from './SystemCard';

export const tierLabel: CSSProperties = { flex: '0 0 120px', margin: 0, paddingTop: 8, ...TYPE.bandLabel, textTransform: 'uppercase' };

/** The arrow sentence sits under the cards; the 130px indent applies only once the label is beside them. */
export const arrowIndent = 'clamp(0px, calc((100% - 400px) * 10), 130px)';

type CardShared = Pick<SystemCardProps, 'labels' | 'overlay' | 'tones'>;

export interface TierRowViewProps extends CardShared {
    tier: TierRow;
    name: string;
    arrow: string | undefined;
    foundOf(stationId: string): SystemCardProps['found'];
    selectedId: string | null;
    dim(stationId: string): boolean;
    onSelect(id: string): void;
    /** Opens the List on this tier's files. */
    onMore(tier: TierRow): void;
}

export function TierRowView({ tier, name, arrow, labels, overlay, tones, foundOf, selectedId, dim, onSelect, onMore }: TierRowViewProps) {
    const s = labels.surface.system;
    return (
        <section aria-label={name} data-tier={tier.layer} style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 auto' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, flex: 1 }}>
                <h3 style={{ ...tierLabel, color: cssVar(BAND_TONE[tier.layer] ?? 'muted') }}>{name}</h3>
                <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', gap: 6, overflowX: 'auto' }}>
                    {tier.shown.map((st) => (
                        <SystemCard
                            key={st.id} station={st} labels={labels} overlay={overlay} tones={tones} found={foundOf(st.id)}
                            selected={selectedId === st.id} dim={dim(st.id)} onSelect={onSelect}
                        />
                    ))}
                    {tier.hidden > 0 && (
                        <button
                            type="button" data-more={tier.layer} aria-label={fillTemplate(s.moreAria, { count: tier.hidden, layer: name })}
                            style={{ ...cardBox(false, false, true), alignItems: 'center', justifyContent: 'center', ...TYPE.pill }}
                            onClick={() => onMore(tier)}
                        >
                            {fillTemplate(s.more, { count: tier.hidden })}
                        </button>
                    )}
                </div>
            </div>
            {arrow && <span style={{ ...TYPE.caption, paddingInlineStart: arrowIndent }}>{arrow}</span>}
        </section>
    );
}
