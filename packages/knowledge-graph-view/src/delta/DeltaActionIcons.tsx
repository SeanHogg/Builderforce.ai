/**
 * The two run-delta action icons — Resolve (a check in a circle) and Copy diagnostics (two
 * overlapping sheets) — plus the shared icon-only button that hosts them. The icons follow
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

export interface DeltaIconButtonProps {
    label: string;
    title?: string | undefined;
    onClick?: (() => void) | undefined;
    disabled?: boolean | undefined;
    children: ReactNode;
}

/** An accessible icon-only button: the label is the aria-label and (by default) the hover title. */
export function DeltaIconButton({ label, title, onClick, disabled, children }: DeltaIconButtonProps) {
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
        <button type="button" aria-label={label} title={title ?? label} onClick={onClick} disabled={disabled} style={style}>
            {children}
        </button>
    );
}
