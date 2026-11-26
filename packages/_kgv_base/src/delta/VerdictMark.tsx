/**
 * A verdict as word + icon + colour (PRD 41 §C11 UI rules: colour is never the only signal). The
 * icon is a small inline SVG drawn in `currentColor`, so it takes the verdict's theme token; the
 * word is always rendered as text.
 */

import type { CSSProperties } from 'react';
import type { Verdict } from '@builderforce/run-delta/contract';
import { cssVar } from '../scene/themeColors';
import { TYPE } from '../surface/ui/type';
import { verdictLabel } from './deltaText';
import type { RunDeltaLabels } from './labels';

/** Theme tokens only: danger, success, warning, muted. */
export const VERDICT_TONE: Record<Verdict, string> = {
    worse: cssVar('sev5'),
    better: cssVar('sev1'),
    not_comparable: cssVar('sev3'),
    same: cssVar('muted'),
    not_measured: cssVar('muted'),
};

const PATHS: Record<Verdict, string> = {
    // A down arrow, an up arrow, an equals sign, a slashed circle, a dashed circle.
    worse: 'M8 3v9M4 8.5 8 12.5 12 8.5',
    better: 'M8 13V4M4 7.5 8 3.5 12 7.5',
    same: 'M3.5 6h9M3.5 10h9',
    not_comparable: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M4.2 11.8l7.6-7.6',
    not_measured: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11',
};

export function VerdictIcon({ verdict, size = 14 }: { verdict: Verdict; size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
            <path
                d={PATHS[verdict]}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={verdict === 'not_measured' ? '2 2.2' : undefined}
            />
        </svg>
    );
}

export interface VerdictMarkProps {
    verdict: Verdict;
    labels: RunDeltaLabels;
    style?: CSSProperties | undefined;
}

export function VerdictMark({ verdict, labels, style }: VerdictMarkProps) {
    return (
        <span data-verdict={verdict} style={{ ...TYPE.status, display: 'inline-flex', alignItems: 'center', gap: 4, color: VERDICT_TONE[verdict], whiteSpace: 'nowrap', ...style }}>
            <VerdictIcon verdict={verdict} />
            {verdictLabel(labels, verdict)}
        </span>
    );
}

/** A small outlined tag (a reason, ≈): one quiet style for every chip, no fill confetti. */
export const reasonTag: CSSProperties = {
    ...TYPE.tag,
    display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 20, padding: '1px 6px', borderRadius: 4,
    border: `1px solid ${cssVar('border')}`, color: cssVar('muted'), maxWidth: '100%', overflowWrap: 'anywhere',
};
