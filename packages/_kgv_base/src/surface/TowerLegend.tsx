/**
 * "Reading the Tower now": the key to an anti-pattern highlight in the Tower, with what good looks
 * like. The root draws it over the scene's non-scrolling frame, only while a highlight is active;
 * the close button clears it. On a narrow view it is one line (a chip) that opens on tap.
 * Tokens only.
 */

import { useState } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { card, quietButton } from '../styles';
import { TYPE } from './ui/type';
import { ruleText } from './drawers/antiPatternRules';
import type { TowerHighlight } from './towerHighlight';

const swatch = (tone: ThemeTone) => <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 2, flex: 'none', background: cssVar(tone) }} />;
const TAP = 32;

export function TowerLegend({ highlight, labels, compact = false, onClose }: { highlight: TowerHighlight; labels: KnowledgeGraphLabels; compact?: boolean; onClose(): void }) {
    const t = labels.surface.patterns;
    const [open, setOpen] = useState(false);
    const row = { display: 'flex', gap: 8, alignItems: 'center', ...TYPE.body } as const;
    const good = [...new Set(highlight.kinds.map((k) => ruleText(k, labels).good))];
    const place = { position: 'absolute', insetInlineStart: 12, bottom: 40, boxSizing: 'border-box', maxWidth: 'calc(100% - 24px)' } as const;
    const close = <button type="button" aria-label={t.legendClose} style={{ ...quietButton, minWidth: TAP, minHeight: TAP, padding: 0 }} onClick={onClose}>×</button>;
    if (compact && !open) {
        return (
            <div data-testid="kg-tower-legend" data-collapsed style={{ ...card, ...place, display: 'flex', alignItems: 'center', gap: 4, padding: '0 0 0 10px', background: cssVar('panel') }}>
                <button type="button" aria-expanded={false} style={{ ...quietButton, minHeight: TAP, border: 0, padding: '0 6px', ...TYPE.subtitle }} onClick={() => setOpen(true)}>{t.legendTitle}</button>
                {close}
            </div>
        );
    }
    return (
        <section
            aria-label={t.legendTitle} data-testid="kg-tower-legend"
            style={{ ...card, ...place, width: 'min(340px, calc(100% - 24px))', display: 'grid', gap: 8, background: cssVar('panel') }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {compact
                    ? <button type="button" aria-expanded style={{ ...quietButton, flex: 1, minHeight: TAP, border: 0, justifyContent: 'flex-start', textAlign: 'start', ...TYPE.subtitle }} onClick={() => setOpen(false)}>{t.legendTitle}</button>
                    : <strong style={{ ...TYPE.subtitle, flex: 1 }}>{t.legendTitle}</strong>}
                {close}
            </div>
            <span style={row}>{swatch('violation')}{t.legendOffender}</span>
            <span style={row}>{swatch('partner')}{t.legendPartner}</span>
            <span style={row}>{swatch('w1')}{t.legendOther}</span>
            <span style={row}><span aria-hidden="true" style={{ width: 22, height: 3, flex: 'none', background: cssVar('violation') }} />{t.legendArrow}</span>
            {good.map((g) => <span key={g} style={{ ...TYPE.bodyMuted, lineHeight: 1.5 }}>{g}</span>)}
        </section>
    );
}
