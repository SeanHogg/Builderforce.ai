/**
 * The toolbar's segmented group (design prototype `.seg`): a 1px-bordered, 4px-radius row of flat buttons, wrapping instead of overflowing. A button is an icon
 * and, while it is the active one, its label; `labelled` buttons always show theirs (the 3D | Flat pair). The selected button is the accent wash, bold.
 * The accessible name of every button is its label, whether or not the label is drawn.
 */

import type { CSSProperties, ReactNode } from 'react';
import { cssVar } from '../../scene/themeColors';
import { visuallyHidden } from '../../styles';
import { TYPE } from './type';

export interface SegItem {
    id: string;
    label: string;
    glyph?: ReactNode;
    /** Draw the label even when not selected. */
    labelled?: boolean;
    disabled?: boolean;
    title?: string;
    /** A "not set up" item: dashed. */
    dashed?: boolean;
    testId?: string;
}

export interface SegProps {
    label: string;
    items: readonly SegItem[];
    /** The selected id; null/absent ⇒ none. */
    value: string | null;
    onPick(id: string): void;
    /** Extra children at the end (a More menu), drawn inside the border. */
    trailing?: ReactNode;
    style?: CSSProperties;
}

const group: CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'stretch', border: `1px solid ${cssVar('border')}`, borderRadius: 4, maxWidth: '100%' };

/** A segment button's look; shared with the More menu's trigger so it sits in the group like the rest. */
export const segButtonStyle = (on: boolean, last = false): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 'calc(var(--kg-control, 40px) - 4px)', padding: '0 7px', border: 0,
    borderInlineEnd: last ? 0 : `1px solid ${cssVar('border')}`, background: on ? cssVar('accentSoft') : cssVar('panel'), color: cssVar('text'),
    font: 'inherit', ...(on ? TYPE.pillOn : { ...TYPE.pill, fontWeight: 400 }), whiteSpace: 'nowrap', cursor: 'pointer',
});

export function Seg({ label, items, value, onPick, trailing, style }: SegProps) {
    return (
        <span role="group" aria-label={label} style={{ ...group, ...style }}>
            {items.map((item, i) => {
                const on = item.id === value;
                const shown = on || item.labelled === true;
                return (
                    <button
                        key={item.id} type="button" data-seg={item.id} data-testid={item.testId} aria-pressed={on} aria-label={item.label} title={item.title ?? item.label} disabled={item.disabled}
                        style={{ ...segButtonStyle(on, i === items.length - 1 && !trailing), ...(item.dashed ? { outline: `1px dashed ${cssVar('muted')}`, outlineOffset: -3 } : null), ...(item.disabled ? { opacity: 0.5, cursor: 'default' } : null) }}
                        onClick={() => onPick(item.id)}
                    >
                        {item.glyph}
                        {shown ? <span>{item.label}</span> : <span style={visuallyHidden}>{item.label}</span>}
                    </button>
                );
            })}
            {trailing}
        </span>
    );
}

/** The header's ghost button (design prototype `.btn.ghost`): borderless, 28px; `on` (an open panel) is the accent wash. `icon` makes it square. */
export const ghostButtonStyle = (on = false, icon = false): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 'calc(var(--kg-control, 40px) - 2px)', minWidth: icon ? 'calc(var(--kg-control, 40px) - 2px)' : 0,
    padding: icon ? 0 : '0 10px', border: '1px solid transparent', borderRadius: 4, background: on ? cssVar('accentSoft') : 'transparent', color: cssVar('text'), font: 'inherit', ...TYPE.pill,
    fontWeight: 400, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none',
});
