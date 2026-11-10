/**
 * One architectural style of the Architecture style camera: its name and fit, then every check it was scored on
 * with the measured evidence and up to three example files (selecting one selects the file). Words come from
 * `labels.surface.architectureStyle`, colours from the theme tokens.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { card, chip } from '../../styles';
import { TYPE } from '../ui/type';
import { percentOf, type StyleCheck, type StyleScore } from './architectureStyle';

export { percentOf };

const statusOf = (c: StyleCheck): 'met' | 'partial' | 'missed' => (c.met >= 1 ? 'met' : c.met <= 0 ? 'missed' : 'partial');
const STATUS_TONE = { met: 'accent', partial: 'muted', missed: 'violation' } as const;
const tail = (ref: string): string => ref.slice(Math.max(ref.lastIndexOf('/'), ref.lastIndexOf(':')) + 1) || ref;

function CheckRow({ check, labels, onSelect }: { check: StyleCheck; labels: KnowledgeGraphLabels; onSelect(ref: string): void }) {
    const s = labels.surface.architectureStyle;
    const status = statusOf(check);
    return (
        <li data-check={check.id} data-status={status} style={{ display: 'grid', gap: 2 }}>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'baseline' }}>
                <span style={{ ...TYPE.status, color: cssVar(STATUS_TONE[status]) }}>{s.status[status]}</span>
                <span style={{ ...TYPE.body, color: cssVar('text') }}>{s.checks[check.id]}</span>
            </span>
            <span style={TYPE.meta}>{fillTemplate(s.evidence, { count: check.evidence.count, total: check.evidence.total })}</span>
            {check.evidence.refs.length > 0 && (
                <span role="group" aria-label={s.examples} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {check.evidence.refs.map((ref) => (
                        <button key={ref} type="button" title={ref} onClick={() => onSelect(ref)} style={{ ...chip(false), ...TYPE.mono, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {tail(ref)}
                        </button>
                    ))}
                </span>
            )}
        </li>
    );
}

export function StyleCard({ score, winner, labels, onSelect }: { score: StyleScore; winner: boolean; labels: KnowledgeGraphLabels; onSelect(ref: string): void }) {
    const s = labels.surface.architectureStyle;
    const percent = percentOf(score.fit);
    const name = s.styles[score.id];
    return (
        <section
            data-style={score.id} data-winner={winner || undefined} aria-label={name}
            style={{ ...card, display: 'grid', gap: 8, minWidth: 0, borderColor: winner ? cssVar('accent') : cssVar('border'), background: winner ? cssVar('accentSoft') : cssVar('panel') }}
        >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 10px' }}>
                <h4 style={{ ...TYPE.subtitle, color: cssVar('text'), flex: 1, minWidth: 0 }}>{name}</h4>
                <span style={TYPE.meta}>{fillTemplate(s.fit, { percent })}</span>
            </div>
            <div role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} style={{ height: 5, borderRadius: 3, background: cssVar('edge'), overflow: 'hidden' }}>
                <div style={{ width: `${percent}%`, height: '100%', background: cssVar(winner ? 'accent' : 'muted') }} />
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                {score.checks.map((c) => <CheckRow key={c.id} check={c} labels={labels} onSelect={onSelect} />)}
            </ul>
        </section>
    );
}
