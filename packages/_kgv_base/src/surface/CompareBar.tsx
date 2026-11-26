/**
 * The compare bar (PRD 43 Part C5), over the stage at its top: what is being compared (the source, a commit's sha and
 * message, a restructure's anti-pattern and file), Before | After, play, Apply on a branch (a restructure only: it opens
 * the existing fix flow for the finding), and close. It only shows and drives the ONE compare state (`useCompare`).
 * A baseline the host calls not comparable gives no Before and says why. Tokens only; every row wraps, so 360px holds.
 */

import { useMemo, type CSSProperties } from 'react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { compareReasonText } from '../compareReasons';
import { findingTitle } from '../findingText';
import { labelFor, nodeIndex } from '../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { TYPE } from './ui/type';
import { actionGlyph } from './ui/glyphs';
import { Segmented } from './ui';
import { CardAction, cardAction } from './transit/CardActions';
import type { CompareApi } from './useCompare';

const SHA_LENGTH = 7;

const bar: CSSProperties = {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', padding: '6px 10px', flex: 'none', minWidth: 0,
    borderBottom: `1px solid ${cssVar('border')}`, color: cssVar('text'),
    background: `color-mix(in srgb, ${cssVar('accent')} 8%, ${cssVar('panel')})`,
};

export interface CompareBarProps {
    compare: Pick<CompareApi, 'state' | 'comparable' | 'reasons' | 'playing' | 'setSide' | 'play' | 'close'>;
    /** The graph the stage draws (a restructure's finding and file are read from it). */
    graph: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    /** Apply on a branch: opens the fix flow for the restructure's finding. Absent ⇒ no Apply. */
    onApply?: ((finding: Finding) => void) | undefined;
    /** A restructure being prepared (its file's definitions are being read) or that could not be made: said in words, never skipped. */
    status?: 'loading' | 'none' | null | undefined;
}

export function CompareBar({ compare, graph, labels, onApply, status = null }: CompareBarProps) {
    const t = labels.surface.compare;
    const { state } = compare;
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const note = status && (
        <p role="status" data-compare-note style={{ flexBasis: '100%', margin: 0, padding: state ? 0 : '4px 10px', color: cssVar('muted'), ...TYPE.meta }}>
            {status === 'loading' ? t.restructureLoading : t.restructureNone}
        </p>
    );
    if (!state) return note || null;
    const finding = state.findingId ? graph.findings.find((f) => f.id === state.findingId) : undefined;
    const baselineLike = state.source === 'baseline' || state.source === 'snapshot';
    const hasBefore = !baselineLike || compare.comparable;
    const what = state.source === 'restructure'
        ? fillTemplate(t.sourceRestructure, { kind: finding ? findingTitle(finding, labels) : '', target: finding?.nodes[0] ? labelFor(index, finding.nodes[0]) : '' })
        : state.source === 'commit'
            ? fillTemplate(t.sourceCommit, { sha: (state.commit?.sha ?? '').slice(0, SHA_LENGTH), title: state.commit?.title ?? '' })
            : state.source === 'snapshot' ? t.sourceSnapshot : t.sourceBaseline;
    const play = state.source === 'restructure' ? t.playRestructure : state.source === 'commit' ? t.playHistory : t.playBaseline;
    return (
        <div role="group" aria-label={t.aria} data-compare-bar data-source={state.source} data-side={state.side} style={bar}>
            <span data-compare-what style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere', ...TYPE.body }}>
                {state.source === 'restructure' && <span style={{ color: cssVar('accent'), display: 'inline-flex' }}>{actionGlyph('restructure')}</span>}
                <b>{what}</b>
            </span>
            <Segmented
                label={t.sideGroup} value={state.side} onChange={(id) => compare.setSide(id as 'before' | 'after')}
                items={[
                    { id: 'before', label: labels.compareBefore, disabled: !hasBefore, ...(hasBefore ? {} : { title: t.noBefore }) },
                    { id: 'after', label: labels.compareAfter },
                ]}
            />
            <CardAction id="compare-play" glyph="simulate" label={play} pressed={compare.playing} onClick={compare.play} />
            {state.source === 'restructure' && finding && onApply && (
                <CardAction id="compare-apply" primary glyph="restructure" label={t.apply} title={t.applyTip} onClick={() => onApply(finding)} />
            )}
            <button type="button" data-action="compare-close" aria-label={t.close} title={t.close} onClick={compare.close} style={{ ...cardAction, padding: 0, width: 'var(--kg-control, 40px)', justifyContent: 'center' }}>
                {actionGlyph('close')}
            </button>
            {note}
            {baselineLike && !compare.comparable && (
                <p role="note" data-compare-reasons style={{ flexBasis: '100%', margin: 0, color: cssVar('muted'), ...TYPE.meta }}>
                    {fillTemplate(t.notComparable, { reasons: compare.reasons.map((r) => compareReasonText(labels, r)).join('; ') })}
                </p>
            )}
        </div>
    );
}
