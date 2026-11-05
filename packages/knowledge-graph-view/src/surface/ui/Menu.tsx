/**
 * A popover button + panel ("More questions", the overflow menu). Esc closes and returns focus to
 * the trigger; a pointer press outside closes. Give `items` for an actionable list (role=menu, arrow
 * keys, optional muted sub-line) or `children` for free content (role=dialog, e.g. the overlay form).
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { cssVar } from '../../scene/themeColors';
import { muted } from '../../styles';
import { pillStyle } from './Pill';

export interface MenuItem {
    id: string;
    label: string;
    /** Muted second line. */
    sub?: string;
    disabled?: boolean;
    selected?: boolean;
}

interface MenuBase {
    /** The visible trigger content. */
    trigger: ReactNode;
    /** aria-label of the panel. */
    label: string;
    /** Draws the trigger as selected (accent). */
    active?: boolean;
    title?: string;
    /** Open towards the start edge instead of the end edge. */
    alignStart?: boolean;
    panelStyle?: CSSProperties;
}

export type MenuProps = MenuBase & (
    | { items: readonly MenuItem[]; onSelect(id: string): void; children?: undefined }
    | { children: ReactNode | ((close: () => void) => ReactNode); items?: undefined; onSelect?: undefined }
);

const panel = (alignStart: boolean): CSSProperties => ({
    position: 'absolute', [alignStart ? 'insetInlineStart' : 'insetInlineEnd']: 0, top: '100%', marginTop: 6, zIndex: 4,
    display: 'grid', gap: 2, padding: 6, minWidth: 220, background: cssVar('bg'), border: `1px solid ${cssVar('border')}`,
    borderRadius: 10, boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)',
});

const itemStyle = (selected: boolean, disabled: boolean): CSSProperties => ({
    display: 'grid', gap: 1, textAlign: 'start', padding: '6px 10px', border: 0, borderRadius: 7, font: 'inherit', fontSize: 12,
    color: cssVar('text'), cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    background: selected ? cssVar('accentSoft') : 'transparent', fontWeight: selected ? 700 : 500,
});

export function Menu(props: MenuProps) {
    const { trigger, label, active = false, title, alignStart = false, panelStyle } = props;
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const id = useId();

    // Roving tabindex: the item that holds (or last held) focus is the only tab stop.
    const [cursor, setCursor] = useState<string | null>(null);

    const close = (refocus: boolean) => {
        setOpen(false);
        setCursor(null);
        if (refocus) button.current?.focus();
    };

    const entry = props.items ? (props.items.find((i) => i.selected && !i.disabled) ?? props.items.find((i) => !i.disabled))?.id ?? null : null;
    const stop = cursor ?? entry;

    useEffect(() => {
        if (!open) return undefined;
        const outside = (e: Event) => { if (root.current && !root.current.contains(e.target as Node)) close(false); };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const enabledItems = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

    // Opening an items menu moves focus to its entry item.
    useEffect(() => {
        if (!open || !props.items) return;
        enabledItems().find((el) => el.dataset.item === entry)?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (!open) return;
        if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
        if (!props.items) return;
        const els = enabledItems();
        if (!els.length) return;
        const at = els.indexOf(document.activeElement as HTMLButtonElement);
        let next = -1;
        if (e.key === 'ArrowDown') next = (at + 1) % els.length;
        else if (e.key === 'ArrowUp') next = (at - 1 + els.length) % els.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = els.length - 1;
        if (next < 0) return;
        e.preventDefault();
        els[next]!.focus();
    };

    // Focus leaving the trigger + panel for somewhere else closes the menu (no refocus: focus already went elsewhere).
    const onBlur = (e: FocusEvent<HTMLDivElement>) => {
        if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) close(false);
    };

    const panelId = `${id}-menu`;
    return (
        <div ref={root} style={{ position: 'relative', flex: 'none' }} onKeyDown={onKeyDown} onBlur={onBlur}>
            <button
                ref={button} type="button" title={title} aria-haspopup={props.items ? 'menu' : 'dialog'} aria-expanded={open} aria-controls={open ? panelId : undefined}
                style={pillStyle(active || open)} onClick={() => setOpen((v) => !v)}
            >
                {trigger}
            </button>
            {open && (
                <div id={panelId} role={props.items ? 'menu' : 'dialog'} aria-label={label} style={{ ...panel(alignStart), ...panelStyle }}>
                    {props.items
                        ? props.items.map((item) => (
                            <button
                                key={item.id} type="button" role="menuitem" data-item={item.id} tabIndex={item.id === stop ? 0 : -1} onFocus={() => setCursor(item.id)} data-selected={item.selected ? 'true' : undefined} disabled={item.disabled}
                                style={itemStyle(!!item.selected, !!item.disabled)} onClick={() => { props.onSelect(item.id); close(true); }}
                            >
                                <span>{item.label}</span>
                                {item.sub ? <span style={muted}>{item.sub}</span> : null}
                            </button>
                        ))
                        : typeof props.children === 'function' ? props.children(() => close(true)) : props.children}
                </div>
            )}
        </div>
    );
}
