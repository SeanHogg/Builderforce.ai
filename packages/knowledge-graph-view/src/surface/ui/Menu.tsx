/**
 * A popover button + panel ("More questions", the overflow menu). Esc closes and returns focus to
 * the trigger; a pointer press outside closes. Give `items` for an actionable list (role=menu, arrow
 * keys, optional muted sub-line) or `children` for free content (role=dialog, e.g. the overlay form).
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
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
    /** `pill` (default) is the compact toggle look; `accent` is the 40px accent-soft button with an accent border (Risk overlays). */
    variant?: 'pill' | 'accent';
    /** Arrive open. An items menu moves focus to its entry item, so the first enabled (or selected) action is focused. */
    defaultOpen?: boolean;
    /**
     * What the panel is positioned against: its `trigger` (default) or the nearest positioned ancestor
     * (`container`, e.g. the status strip, for a panel that should span it). Always absolute, never fixed,
     * so it works inside a docked host.
     */
    anchor?: 'trigger' | 'container';
}

const accentStyle = (open: boolean): CSSProperties => ({
    height: 40, padding: '0 12px', borderRadius: 10, cursor: 'pointer', flex: 'none', font: 'inherit', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
    border: `1px solid ${cssVar('accent')}`, background: open ? cssVar('accent') : cssVar('accentSoft'), color: open ? cssVar('onAccent') : cssVar('text'),
});

export type MenuProps = MenuBase & (
    | { items: readonly MenuItem[]; onSelect(id: string): void; children?: undefined }
    | { children: ReactNode | ((close: () => void) => ReactNode); items?: undefined; onSelect?: undefined }
);

const panel = (alignStart: boolean, up: boolean): CSSProperties => ({
    position: 'absolute', [alignStart ? 'insetInlineStart' : 'insetInlineEnd']: 0, zIndex: 4,
    ...(up ? { bottom: '100%', marginBottom: 6 } : { top: '100%', marginTop: 6 }),
    maxWidth: 'calc(100vw - 16px)',
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
    const [open, setOpen] = useState(props.defaultOpen === true);
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

    // Flip: if the panel would leave the viewport on the side it opens towards, open towards the other (measured once it is open).
    const panelEl = useRef<HTMLDivElement>(null);
    const [flip, setFlip] = useState({ x: false, y: false });
    useLayoutEffect(() => {
        if (!open) { setFlip({ x: false, y: false }); return; }
        const el = panelEl.current, trigger = button.current;
        if (!el || !trigger) return;
        const r = el.getBoundingClientRect(), t = trigger.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        if (r.width === 0 && r.height === 0) return; // not laid out (a test DOM)
        const x = alignStart ? r.right > vw : r.left < 0;
        const y = r.bottom > vh && t.top > vh - t.bottom;
        if (x || y) setFlip({ x, y });
    }, [open, alignStart]);

    const panelId = `${id}-menu`;
    const container = props.anchor === 'container';
    return (
        <div ref={root} style={{ position: container ? 'static' : 'relative', flex: 'none' }} onKeyDown={onKeyDown} onBlur={onBlur}>
            <button
                ref={button} type="button" title={title} aria-haspopup={props.items ? 'menu' : 'dialog'} aria-expanded={open} aria-controls={open ? panelId : undefined}
                style={props.variant === 'accent' ? accentStyle(open) : pillStyle(active || open)} onClick={() => setOpen((v) => !v)}
            >
                {trigger}
            </button>
            {open && (
                <div ref={panelEl} id={panelId} role={props.items ? 'menu' : 'dialog'} aria-label={label} style={{ ...panel(flip.x ? !alignStart : alignStart, flip.y), ...panelStyle }}>
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
