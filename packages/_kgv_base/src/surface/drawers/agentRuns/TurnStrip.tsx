/**
 * A run's turns as one bar each, left to right: height ∝ the turn's prompt tokens, fill by its kind (read, write,
 * forced hand-off, text only, failed). Every bar carries its numbers in a title; the legend names the fills in words.
 */

import type { KnowledgeGraphLabels } from '../../../labels';
import { cssVar } from '../../../scene/themeColors';
import { swatch } from '../../../styles';
import type { AgentRunTurn } from '../../../types';
import { TYPE } from '../../ui/type';
import { stripGeometry, TURN_KINDS, TURN_TONE, turnTitle } from './agentRunsModel';

const W = 320, H = 64;

export function TurnStrip({ turns, labels }: { turns: readonly AgentRunTurn[]; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.agentRuns;
    const bars = stripGeometry(turns, W, H);
    return (
        <div style={{ display: 'grid', gap: 8 }}>
            <svg
                data-testid="kg-agent-run-strip" role="img" aria-label={t.stripTitle} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
                style={{ width: '100%', height: H, display: 'block', background: cssVar('plane'), borderRadius: 6 }}
            >
                {bars.map((b) => (
                    <rect key={b.turn.index} data-kind={b.turn.kind} x={b.x} y={b.y} width={b.width} height={b.height} fill={cssVar(TURN_TONE[b.turn.kind])}>
                        <title>{turnTitle(b.turn, t)}</title>
                    </rect>
                ))}
            </svg>
            <ul aria-label={t.legendTitle} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {TURN_KINDS.map((k) => (
                    <li key={k} style={{ ...TYPE.meta, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span aria-hidden="true" style={{ ...swatch(cssVar(TURN_TONE[k])), borderRadius: 2 }} />
                        {t.turnKinds[k]}
                    </li>
                ))}
            </ul>
        </div>
    );
}
