/**
 * A coloured dot plus text: the sync pill. A button when `onClick` is given, else a status
 * region. The state is never colour-only: `stateLabel` (localized by the caller) is appended to
 * the accessible name and `data-state` carries the machine value.
 */

import type { CSSProperties } from 'react';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { CONTROL, swatch } from '../../styles';
import { TYPE } from './type';

/** `serverOnly`: reviewed on the server, never on this machine - neutral, not a fault. `partial`: both sides hold files and the counts differ. */
export type StatusState = 'synced' | 'syncing' | 'error' | 'idle' | 'partial' | 'serverOnly';

export interface StatusDotProps {
    state: StatusState;
    /** The visible text. */
    label: string;
    /** Localized state name, read by assistive tech after the label (e.g. "Synced"). */
    stateLabel?: string;
    title?: string;
    onClick?(): void;
    /** The button opens a card: its expanded state and the card's id (a plain status has neither). */
    expanded?: boolean;
    controls?: string;
}

const TONE: Record<StatusState, ThemeTone> = { synced: 'agrees', syncing: 'accent', error: 'violation', idle: 'unused', partial: 'cycle', serverOnly: 'unused' };

const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: `calc(${CONTROL} - 6px)`, padding: '0 8px', borderRadius: 999,
    border: `1px solid ${cssVar('border')}`, background: 'transparent', color: cssVar('text'), font: 'inherit', ...TYPE.pill, whiteSpace: 'nowrap',
};

export function StatusDot({ state, label, stateLabel, title, onClick, expanded, controls }: StatusDotProps) {
    const name = stateLabel ? `${label} ${stateLabel}` : undefined;
    const dot =<span aria-hidden="true" style={{ ...swatch(cssVar(TONE[state])), opacity: state === 'syncing' ? 0.65 : 1 }} />;
    const text = <>{label}{stateLabel ? <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{` ${stateLabel}`}</span> : null}</>;
    if (onClick) {
        return (
            <button
                type="button" data-state={state} title={title} aria-label={name} aria-expanded={expanded} aria-controls={expanded ? controls : undefined}
                style={{ ...base, cursor: 'pointer', position: 'relative' }} onClick={onClick}
            >
                {dot}{text}
            </button>
        );
    }
    return (
        <span role="status" data-state={state} title={title} aria-label={name} style={{ ...base, position: 'relative' }}>
            {dot}{text}
        </span>
    );
}
