/**
 * The Architecture style camera: the six styles ranked by the deterministic `architectureStyleOf` model, the
 * verdict on top (or "no clear style"), and every check with the evidence it was scored on. No model call: the
 * same graph always reads the same.
 */

import { useMemo } from 'react';
import { fillTemplate } from '../labels';
import { cssVar } from '../scene/themeColors';
import type { SceneProps } from './registry';
import { architectureStyleOf } from './style/architectureStyle';
import { hasLayeredCode } from './style/signals';
import { percentOf, StyleCard } from './style/StyleCard';
import { TYPE } from './ui/type';

export function ArchitectureStyleCamera({ graph, labels, onSelect }: SceneProps) {
    const s = labels.surface.architectureStyle;
    const ready = useMemo(() => hasLayeredCode(graph), [graph]);
    const analysis = useMemo(() => (ready ? architectureStyleOf(graph) : null), [graph, ready]);
    const top = analysis?.styles[0];
    return (
        <div data-testid="kg-style" role="group" aria-label={s.title} style={{ display: 'grid', gap: 12, padding: 12, color: cssVar('text'), boxSizing: 'border-box' }}>
            <h3 style={TYPE.sectionHeading}>{s.title}</h3>
            <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{s.description}</p>
            {!analysis || !top ? <p style={{ ...TYPE.bodyLarge, margin: 0 }}>{s.empty}</p> : (
                <>
                    <p data-testid="kg-style-verdict" style={{ ...TYPE.subtitle, color: cssVar('text') }}>
                        {analysis.winner ? fillTemplate(s.verdict, { style: s.styles[analysis.winner], percent: percentOf(top.fit) }) : s.verdictNone}
                    </p>
                    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
                        {analysis.styles.map((row) => <StyleCard key={row.id} score={row} winner={row.id === analysis.winner} labels={labels} onSelect={onSelect} />)}
                    </div>
                </>
            )}
        </div>
    );
}
