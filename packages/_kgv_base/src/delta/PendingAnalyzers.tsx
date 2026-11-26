/**
 * The L3 analyzers a phase-1 delta is still waiting on (PRD 41 §6 "Agent run": the card is posted measuring and filled as
 * the analyzers settle): every `MeasuredBy.status: 'pending'` tool, once, as "<tool> — measuring…". Rendered by the card
 * (a compact line) and the panel (a section beside "Checks that did not run"); nothing when no tool is pending, so a
 * final delta shows no trace of it. Props only; theme variables; wraps at 360 px.
 */

import type { RunDelta } from '@builderforce/run-delta/contract';
import { cssVar } from '../scene/themeColors';
import { list } from '../styles';
import { TYPE } from '../surface/ui/type';
import { fillTemplate } from '../template';
import type { RunDeltaLabels } from './labels';

/** The tools still measuring, sorted, each once. */
export function pendingTools(delta: Pick<RunDelta, 'dimensions'>): string[] {
    return [...new Set(delta.dimensions.flatMap((d) => d.measuredBy.filter((m) => m.status === 'pending').map((m) => m.tool)))].sort();
}

export interface PendingAnalyzersProps {
    delta: Pick<RunDelta, 'dimensions'>;
    labels: RunDeltaLabels;
    /** `section`: the panel's heading and list; `line`: the card's one wrapped row. */
    variant: 'section' | 'line';
}

export function PendingAnalyzers({ delta, labels, variant }: PendingAnalyzersProps) {
    const tools = pendingTools(delta);
    if (tools.length === 0) return null;
    const items = tools.map((tool) => (
        <li key={tool} data-pending={tool} style={{ ...TYPE.meta, color: cssVar('muted'), overflowWrap: 'anywhere' }}>
            {fillTemplate(labels.measuringTool, { tool })}
        </li>
    ));
    if (variant === 'line') {
        return (
            <ul aria-label={labels.measuringHeading} style={{ ...list, display: 'flex', flexWrap: 'wrap', columnGap: 10, rowGap: 2, minWidth: 0 }}>
                {items}
            </ul>
        );
    }
    return (
        <section data-measuring style={{ display: 'grid', gap: 4 }}>
            <h3 style={TYPE.title}>{labels.measuringHeading}</h3>
            <ul style={{ ...list, gap: 2 }}>{items}</ul>
        </section>
    );
}
