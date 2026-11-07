/**
 * The fix flow for the finding Resolve works on, after the mockup: the queue counts, a
 * Deterministic fix | Prompt switch, what the fix changes (or the read-only prompt), the four
 * checks, ONE primary action whose label advances with Undo and Before/After beside it, the
 * permissions note, and the clickable fix queue.
 */

import { useCallback, useMemo } from 'react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { findingItems, findingTitle } from '../../findingText';
import { nodeIndex } from '../../graphModel';
import { muted } from '../../styles';
import { TYPE } from '../ui/type';
import type { PanelProps } from '../registry';
import { Section } from '../drawers/ui';
import { Segmented } from '../ui';
import { FixChecksList } from './FixChecksList';
import { FixPreviewView } from './FixPreviewView';
import { FixPrimary } from './FixPrimary';
import { FixQueueList } from './FixQueueList';
import { initialFlow, isResolved, type FixFlowAction, type FixMode } from './fixFlow';
import { fixQueueCounts, fixQueueText, promptRequest } from './fixModes';
import { useFixFlow } from './useFixFlow';
import { canApplyKind } from '../codemods';

type Props = Pick<PanelProps, 'graph' | 'labels' | 'source' | 'onCompose' | 'onChanged' | 'revision' | 'surface'> & { finding: Finding; queue: readonly Finding[] };

export function FixFlowView({ finding, graph, labels, source, onCompose, onChanged, queue, revision, surface }: Props) {
    const t = labels.surface.fix;
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const { dispatchFix } = surface;
    const dispatch = useCallback((action: FixFlowAction) => dispatchFix(finding.id, action), [dispatchFix, finding.id]);
    const state = surface.fixFlows[finding.id] ?? initialFlow(finding.id);
    const flow = useFixFlow({ finding, state, dispatch, source, labels, index, onCompose, onChanged });
    const codemod = canApplyKind(source, finding.kind);
    const resolved = useMemo(() => new Set(Object.values(surface.fixFlows).filter(isResolved).map((f) => f.findingId)), [surface.fixFlows]);
    const counts = fixQueueCounts(queue.length > 0 ? queue : [finding], graph.findings.length, resolved);
    return (
        <div data-testid="kg-fix-flow" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
            <Section title={t.title}>
                <p data-testid="kg-fix-queue" style={{ ...muted, margin: 0 }}>{fixQueueText(counts, labels)}</p>
                <Segmented
                    label={t.mode.group} value={flow.mode} onChange={(id) => flow.setMode(id as FixMode)}
                    items={[{ id: 'apply', label: t.mode.apply, disabled: !codemod, ...(codemod ? {} : { title: t.mode.noCodemod }) }, { id: 'prompt', label: t.mode.prompt }]}
                />
                {flow.mode === 'apply'
                    ? <FixPreviewView files={flow.preview.files} fromHost={flow.preview.fromHost} labels={labels} />
                    : (
                        <div style={{ display: 'grid', gap: 4 }}>
                            <textarea
                                readOnly aria-label={t.promptTitle} value={promptRequest(findingTitle(finding, labels), labels, findingItems(finding, index))}
                                style={{ minHeight: 96, resize: 'none', padding: 8, borderRadius: 8, font: 'inherit', ...TYPE.body, minWidth: 0, boxSizing: 'border-box', background: 'transparent', color: 'inherit', border: '1px solid currentColor' }}
                            />
                            <span style={muted}>{t.promptNote}</span>
                        </div>
                    )}
            </Section>
            <Section title={t.checksTitle}>
                <FixChecksList checks={state.checks} details={state.details} labels={labels} />
                <FixPrimary flow={flow} labels={labels} hasComposer={!!onCompose} revision={revision} />
            </Section>
            <Section title={`${t.queueTitle} · ${counts.open}`}>
                <FixQueueList findings={queue} flows={surface.fixFlows} current={finding.id} labels={labels} onPick={surface.resolve} />
            </Section>
        </div>
    );
}
