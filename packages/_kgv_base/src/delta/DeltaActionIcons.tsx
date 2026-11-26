/**
 * The run-delta action icons — Resolve (a check in a circle), Copy diagnostics (two
 * overlapping sheets), Open details (an arrow leaving a panel) and the Expand/Collapse
 * chevron — plus the shared icon-only button that hosts them. The icons follow
 * {@link VerdictIcon}'s conventions exactly (PRD 41 §C11 UI rules: `currentColor`, never colour
 * alone); the button mirrors `quietButton` in `../styles` so it reads as the same control.
 */

import type { CSSProperties, ReactNode } from 'react';
import { cssVar } from '../scene/themeColors';
import { quietButton } from '../styles';

const SVG_PROPS = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
} as const;

export function ResolveIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} aria-hidden="true" focusable="false" style={{ flex: 'none' }} {...SVG_PROPS}>
            <path d="M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11" />
            <path d="M5 8.2l2 2 3.8-4.2" />
        </svg>
    );
}

export function CopyIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} aria-hidden="true" focusable="false" style={{ flex: 'none' }} {...SVG_PROPS}>
            <path d="M5.5 3.5h6v8.5h-6z" />
            <path d="M3.5 9V2.5H9" />
        </svg>
    );
}

/** An arrow leaving a panel: opens the full delta details surface. */
export function OpenDetailsIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} aria-hidden="true" focusable="false" style={{ flex: 'none' }} {...SVG_PROPS}>
            <rect x="2.5" y="6.5" width="8" height="7" rx="1.5" />
            <path d="M6 10L13.5 2.5" />
            <path d="M9.5 2.5H13.5V6.5" />
        </svg>
    );
}

/** The card header's expand/collapse caret: points right, rotates 90° when expanded. */
export function ChevronIcon({ size = 14, expanded = false }: { size?: number; expanded?: boolean }) {
    const style: CSSProperties = {
        flex: 'none',
        transform: expanded ? 'rotate(90deg)' : undefined,
        transition: 'transform 120ms ease',
    };
    return (
        <svg width={size} height={size} aria-hidden="true" focusable="false" style={style} {...SVG_PROPS}>
            <path d="M6 4l4 4-4 4" />
        </svg>
    );
}

export interface DeltaIconButtonProps {
    label: string;
    title?: string | undefined;
    onClick?: (() => void) | undefined;
    disabled?: boolean | undefined;
    /** Present on a toggle: sets `aria-expanded`/`data-expanded` so the chevron can rotate. */
    expanded?: boolean | undefined;
    children: ReactNode;
}

/** An accessible icon-only button: the label is the aria-label and (by default) the hover title. */
export function DeltaIconButton({ label, title, onClick, disabled, expanded, children }: DeltaIconButtonProps) {
    const style: CSSProperties = {
        ...quietButton,
        background: 'transparent',
        padding: 4,
        borderRadius: 4,
        border: `1px solid ${cssVar('border')}`,
        color: cssVar('text'),
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
    };
    return (
        <button type="button" aria-label={label} title={title ?? label} onClick={onClick} disabled={disabled} aria-expanded={expanded} data-expanded={expanded} style={style}>
            {children}
        </button>
    );
}

// Evidence re-verification: busts the verify cache (content-hash key) so the pre-push
// gate re-runs checks against the repaired install instead of replaying a stale record.
