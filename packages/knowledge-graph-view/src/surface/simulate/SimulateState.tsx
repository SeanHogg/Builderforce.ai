/** What the simulation shows at the current step: the code lines with their notes, the variables table and the result box. */

import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { card, MONO, muted } from '../../styles';
import type { SimStep } from './simulateModel';

export function SimulateCode({ step, labels }: { step: SimStep; labels: KnowledgeGraphLabels }) {
    return (
        <ol aria-label={labels.surface.simulate.codeTitle} data-testid="kg-sim-code" style={{ ...card, listStyle: 'none', margin: 0, display: 'grid', gap: 2, fontFamily: MONO, fontSize: 12, overflowX: 'auto' }}>
            {step.lines.map((l) => (
                <li key={l.n} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span aria-hidden="true" style={{ color: cssVar('muted'), width: 16, textAlign: 'end' }}>{l.n}</span>
                    <span>{l.text}</span>
                    {l.note && <span data-note style={{ color: cssVar('muted') }}>// {l.note}</span>}
                </li>
            ))}
        </ol>
    );
}

export function SimulateVariables({ step, labels }: { step: SimStep; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.simulate;
    if (step.vars.length === 0) return <p style={{ ...muted, margin: 0 }}>{t.noVars}</p>;
    return (
        <table data-testid="kg-sim-vars" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <caption style={{ ...muted, textAlign: 'start', paddingBottom: 4 }}>{t.varsTitle}</caption>
            <tbody>
                {step.vars.map((v) => (
                    <tr key={`${v.stopId}:${v.name}`} data-origin={v.origin}>
                        <th scope="row" style={{ textAlign: 'start', padding: '2px 6px', fontFamily: MONO }}>{v.name}</th>
                        <td style={{ padding: '2px 6px', fontFamily: MONO, overflowWrap: 'anywhere' }}>{v.value}</td>
                        <td style={{ padding: '2px 6px', color: cssVar(v.origin === 'edited' ? 'accent' : 'muted') }}>{t.origin[v.origin]}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function SimulateResult({ step, labels }: { step: SimStep; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.simulate;
    return (
        <div role="status" data-testid="kg-sim-result" data-origin={step.result?.origin ?? 'none'} style={{ ...card, display: 'grid', gap: 2 }}>
            <span style={muted}>{t.resultTitle}</span>
            <strong style={{ fontFamily: MONO, fontSize: 13, overflowWrap: 'anywhere' }}>{step.result ? step.result.value : t.noResult}</strong>
            {step.stubbed && <span style={muted}>{t.stubbedNote}</span>}
        </div>
    );
}
