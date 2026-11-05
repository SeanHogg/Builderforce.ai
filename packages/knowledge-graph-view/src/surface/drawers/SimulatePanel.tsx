/**
 * The Simulate drawer, agent-run: it draws the path (the selected line's, or a pinpoint's),
 * takes the values the person types, and composes ONE request asking the agent to write and
 * run a test that drives that path with them and report each step. It never fakes a result:
 * what comes back is the agent's own run.
 */

import { useState } from 'react';
import { fillTemplate } from '../../labels';
import { button, chip, input, muted, primaryButton } from '../../styles';
import type { PanelProps } from '../registry';
import { Section } from './ui';

export function SimulatePanel({ labels, surface, onCompose }: PanelProps) {
    const t = labels.surface.simulate;
    const [values, setValues] = useState('');
    const [sent, setSent] = useState(false);
    const stops = surface.path.stops;
    if (stops.length === 0) return <p style={{ ...muted, margin: 0 }}>{t.pathEmpty}</p>;

    const request = () => fillTemplate(t.requestText, { path: stops.map((s) => s.name).join(' → '), values: values.trim() || t.noValues });
    const run = () => { onCompose?.(request()); setSent(true); };

    return (
        <div data-testid="kg-simulate" style={{ display: 'grid', gap: 16 }}>
            <Section title={t.pathTitle}>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {stops.map((s, i) => (
                        <li key={s.id}>
                            <button type="button" aria-current={i === surface.step ? 'step' : undefined} style={chip(i === surface.step)} onClick={() => surface.setStep(i)}>{s.name}</button>
                        </li>
                    ))}
                </ol>
            </Section>
            <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.valuesLabel}</span>
                <textarea
                    value={values} rows={3} placeholder={t.valuesPlaceholder} onChange={(e) => { setValues(e.target.value); setSent(false); }}
                    style={{ ...input, minHeight: 72, padding: 8, resize: 'vertical' }}
                />
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" style={onCompose ? primaryButton : button} disabled={!onCompose} onClick={run}>{t.run}</button>
                {sent && <span role="status" style={muted}>{t.sent}</span>}
            </div>
            {!onCompose && <p style={{ ...muted, margin: 0 }}>{t.noComposer}</p>}
            <p style={{ ...muted, margin: 0 }}>{t.note}</p>
        </div>
    );
}
