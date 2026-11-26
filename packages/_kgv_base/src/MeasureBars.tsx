/** A file's measures drawn against their limits (the mockup's C3): value, limit, a bar and the limit mark; over the limit reads in the violation tone, under it in agrees. A measure the graph lacks says so. */

import type { KnowledgeGraphLabels } from './labels';
import { fillTemplate } from './labels';
import { LIMIT_MARK, measureBar, type Measure } from './measures';
import { cssVar } from './scene/themeColors';
import { muted } from './styles';

export function MeasureBars({ measures, labels }: { measures: readonly Measure[]; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.patterns.block;
    return (
        <div role="group" aria-label={t.measuresTitle} style={{ display: 'grid', gap: 8 }}>
            {measures.map((m) => {
                const bar = m.value !== undefined && m.limit !== undefined ? measureBar(m.value, m.limit) : null;
                return (
                    <div key={m.id} data-measure={m.id} data-over={bar ? String(bar.over) : undefined} style={{ display: 'grid', gap: 3 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{ flex: 1, minWidth: 0 }}>{t[m.labelKey]}</span>
                            {m.value === undefined
                                ? <span style={muted}>{t.notMeasured}</span>
                                : <strong style={{ color: bar?.over ? cssVar('violation') : cssVar('text') }}>{m.value.toLocaleString()}</strong>}
                            {m.limit !== undefined && <span style={muted}>{fillTemplate(t.limit, { limit: m.limit.toLocaleString() })}</span>}
                        </div>
                        {bar && (
                            <div style={{ position: 'relative', height: 6, borderRadius: 3, background: cssVar('plane') }}>
                                <div data-fill style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: `${Math.round(bar.frac * 100)}%`, borderRadius: 3, background: cssVar(bar.over ? 'violation' : 'agrees') }} />
                                <div aria-hidden="true" style={{ position: 'absolute', insetInlineStart: `${LIMIT_MARK * 100}%`, top: -3, width: 2, height: 12, background: cssVar('text') }} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
