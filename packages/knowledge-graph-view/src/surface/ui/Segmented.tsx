/**
 * A bordered group of buttons where the selected one is solid accent. `select` mode is a radio
 * group (one value, arrow keys move and select, one tab stop); `toggle` mode is a panel group
 * (aria-pressed buttons, none may be selected, clicking the selected one clears it).
 */

import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { cssVar } from '../../scene/themeColors';
import { CONTROL } from '../../styles';

export interface SegmentedItem {
    id: string;
    label: string;
    title?: string;
    disabled?: boolean;
}

interface SegmentedBase {
    /** aria-label of the group. */
    label: string;
    items: readonly SegmentedItem[];
    style?: CSSProperties;
}

export type SegmentedProps = SegmentedBase & (
    | { mode?: 'select'; value: string; onChange(id: string): void }
    | { mode: 'toggle'; value: string | null; onChange(id: string | null): void }
);

const group: CSSProperties = {
    display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, flex: 'none',
    border: `1px solid ${cssVar('border')}`, background: cssVar('panel'),
};

const segment = (on: boolean): CSSProperties => ({
    height: CONTROL, padding: '0 10px', borderRadius: 7, border: 0, cursor: 'pointer', font: 'inherit',
    fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    background: on ? cssVar('accent') : 'transparent', color: on ? cssVar('onAccent') : cssVar('text'),
});

export function Segmented(props: SegmentedProps) {
    const { label, items, style } = props;
    const ref = useRef<HTMLDivElement>(null);
    const toggle = props.mode === 'toggle';

    const move = (e: KeyboardEvent<HTMLDivElement>) => {
        if (toggle) return;
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        const enabled = items.filter((i) => !i.disabled);
        if (!enabled.length) return;
        e.preventDefault();
        const at = enabled.findIndex((i) => i.id === props.value);
        const next = enabled[(at + step + enabled.length) % enabled.length]!;
        (props as { onChange(id: string): void }).onChange(next.id);
        [...(ref.current?.querySelectorAll<HTMLButtonElement>('[data-seg]') ?? [])].find((b) => b.dataset.seg === next.id)?.focus();
    };

    // Select mode: one tab stop — the selected item, else the first enabled one.
    const stop = toggle ? null : (items.find((i) => i.id === props.value && !i.disabled) ?? items.find((i) => !i.disabled))?.id;

    return (
        <div ref={ref} role={toggle ? 'group' : 'radiogroup'} aria-label={label} style={{ ...group, ...style }} onKeyDown={move}>
            {items.map((item) => {
                const on = item.id === props.value;
                return (
                    <button
                        key={item.id} type="button" data-seg={item.id} title={item.title} disabled={item.disabled}
                        {...(toggle ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on, tabIndex: item.id === stop ? 0 : -1 })}
                        style={{ ...segment(on), opacity: item.disabled ? 0.5 : 1 }}
                        onClick={() => {
                            if (props.mode === 'toggle') props.onChange(on ? null : item.id);
                            else props.onChange(item.id);
                        }}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}
