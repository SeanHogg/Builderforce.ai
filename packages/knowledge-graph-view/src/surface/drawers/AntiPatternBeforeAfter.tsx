/**
 * Before and after for one group (the mockup's C2): the picture its rule names. A layer violation
 * draws the real top files with the link climbing, then the port version; a god module draws the
 * file and its measures, then the plan; any other kind lists its files, then the plan. The words
 * come from the rules table, never from the component.
 */

import type { ReactElement } from 'react';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { labelFor } from '../../graphModel';
import { measuresOf } from '../../measures';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../ui/type';
import type { AntiPatternGroup } from './antiPatternGroups';
import { layerNames } from './AntiPatternCard';
import { ruleOf, ruleText } from './antiPatternRules';
import { baseName, FileArrow } from './LayerArrow';

const heading = (text: string, tone: 'violation' | 'agrees') => (
    <span style={{ ...TYPE.tag, letterSpacing: '0.08em', textTransform: 'uppercase', color: cssVar(tone) }}>{text}</span>
);

export function AntiPatternBeforeAfter({ group, labels, index }: { group: AntiPatternGroup; labels: KnowledgeGraphLabels; index: ReadonlyMap<string, KNode> }) {
    const t = labels.surface.patterns;
    const names = layerNames(group, labels);
    const text = ruleText(group.kind, labels, { from: names.from, to: names.to });
    const diagram = ruleOf(group.kind).diagram;
    const first = group.findings[0]!;
    const offender = labelFor(index, first.nodes[0] ?? ''), partner = labelFor(index, first.nodes[1] ?? '');
    const mono = { ...TYPE.mono, overflowWrap: 'anywhere' } as const;
    let before: ReactElement, after: ReactElement;
    if (diagram === 'layerArrow') {
        before = <FileArrow top={partner} bottom={offender} state="before" aria={fillTemplate(t.beforeAria, { from: offender, to: partner })} />;
        after = <FileArrow top={partner} bottom={fillTemplate(t.withPort, { file: baseName(offender) })} state="after" aria={fillTemplate(t.afterAria, { from: offender, to: partner })} />;
    } else {
        const file = group.files[0] ?? '';
        const node = index.get(file);
        const shown = measuresOf(node, first).filter((m) => m.value !== undefined);
        before = (
            <div style={{ display: 'grid', gap: 4, padding: 8, border: `1px solid ${cssVar('violation')}`, borderRadius: 6, background: cssVar('plane') }}>
                <span style={mono}>{diagram === 'measures' ? labelFor(index, file) : group.files.slice(0, 3).map((r) => labelFor(index, r)).join(', ')}</span>
                {diagram === 'measures' && shown.map((m) => (
                    <span key={m.id} style={TYPE.body}>{labels.surface.patterns.block[m.labelKey]}: <strong>{m.value!.toLocaleString()}</strong></span>
                ))}
            </div>
        );
        after = <div style={{ ...TYPE.body, padding: 8, border: `1px solid ${cssVar('agrees')}`, borderRadius: 6 }}>{text.after}</div>;
    }
    return (
        <div data-testid="kg-before-after" data-diagram={diagram} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div style={{ display: 'grid', gap: 6, alignContent: 'start', minWidth: 0 }}>{heading(t.before, 'violation')}{before}</div>
            <div style={{ display: 'grid', gap: 6, alignContent: 'start', minWidth: 0 }}>
                {heading(diagram === 'layerArrow' ? t.after : t.afterPlanned, 'agrees')}
                {after}
                {diagram === 'layerArrow' && <span style={{ ...TYPE.body, color: cssVar('text') }}>{text.after}</span>}
            </div>
        </div>
    );
}
