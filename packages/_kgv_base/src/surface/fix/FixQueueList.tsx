/** The fix queue: the findings in scope as a clickable list, each with its pin (heat by severity), what kind it is and its state in the flow. */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { findingTitle } from '../../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { muted } from '../../styles';
import { TYPE } from '../ui/type';
import { LEVEL } from '../actModel';
import { Pin } from '../ui';
import { queueState, type FixFlowState } from './fixFlow';

/** Rows drawn at most; the counts above say how many there are. */
export const QUEUE_ROWS = 30;

export interface FixQueueListProps {
    findings: readonly Finding[];
    flows: Readonly<Record<string, FixFlowState>>;
    current: string;
    labels: KnowledgeGraphLabels;
    onPick(finding: Finding): void;
}

export function FixQueueList({ findings, flows, current, labels, onPick }: FixQueueListProps) {
    const t = labels.surface.fix;
    return (
        <ul aria-label={t.queueTitle} data-testid="kg-fix-queue-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {findings.slice(0, QUEUE_ROWS).map((f, i) => {
                const state = queueState(flows[f.id]);
                const title = findingTitle(f, labels);
                return (
                    <li key={f.id}>
                        <button
                            type="button" aria-pressed={f.id === current} aria-label={fillTemplate(t.queueAria, { title })} data-queue={f.id} data-state={state} onClick={() => onPick(f)}
                            style={{
                                display: 'flex', gap: 8, alignItems: 'center', width: '100%', minWidth: 0, minHeight: 36, padding: '4px 8px', textAlign: 'start', cursor: 'pointer', font: 'inherit', ...TYPE.body,
                                borderRadius: 8, color: cssVar('text'), border: `1px solid ${cssVar(f.id === current ? 'accent' : 'border')}`, background: f.id === current ? cssVar('accentSoft') : 'transparent',
                            }}
                        >
                            <Pin n={i + 1} level={LEVEL[f.severity]} resolved={state === 'resolved'} size={20} />
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: TYPE.pill.fontWeight }}>{title}</span>
                            <span style={{ ...muted, flex: 'none', color: cssVar(state === 'resolved' ? 'agrees' : state === 'applied' ? 'accent' : 'muted') }}>{t.queueState[state]}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
