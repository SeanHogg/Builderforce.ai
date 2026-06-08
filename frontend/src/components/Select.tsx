'use client';

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Drop-in replacement for a native `<select>`.
 *
 * Native `<select>` dropdown popups can't be reliably themed on Chrome/Windows:
 * the browser honours `color` on `<option>` but ignores `background-color`, and
 * an author background on the control forces the popup to paint light — so in
 * dark mode you get white option text on a white popup. This renders its own
 * themed popup (portaled to <body> so it isn't clipped by panel `overflow`)
 * while keeping the native API surface: pass `<option>` / `<optgroup>` children,
 * a `value`/`defaultValue`, and an `onChange` that receives `{ target: { value } }`
 * so existing `(e) => setX(e.target.value)` handlers work unchanged.
 */

export interface SelectChangeEvent {
  target: { value: string };
  /** No-op for parity with native onChange handlers that call it. */
  stopPropagation: () => void;
}

export interface SelectProps {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: SelectChangeEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  title?: string;
  style?: CSSProperties;
  className?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

interface FlatOption {
  value: string;
  label: ReactNode;
  text: string;
  disabled?: boolean;
}
type RenderRow = { kind: 'group'; label: string } | { kind: 'option'; index: number };

function textOf(node: ReactNode, fallback: string): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => textOf(n, '')).join('') || fallback;
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children, fallback);
  return fallback;
}

/** Walk `<option>` / `<optgroup>` children into a flat option list + render rows. */
function collect(children: ReactNode): { options: FlatOption[]; rows: RenderRow[] } {
  const options: FlatOption[] = [];
  const rows: RenderRow[] = [];

  const pushOption = (el: ReactNode) => {
    if (!isValidElement(el)) return;
    const props = el.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    const value = String(props.value ?? '');
    const index = options.length;
    options.push({ value, label: props.children, text: textOf(props.children, value), disabled: props.disabled });
    rows.push({ kind: 'option', index });
  };

  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'optgroup') {
      const props = child.props as { label?: string; children?: ReactNode };
      rows.push({ kind: 'group', label: props.label ?? '' });
      Children.toArray(props.children).forEach(pushOption);
    } else {
      // `<option>` (and any stray element treated as one)
      pushOption(child);
    }
  });

  return { options, rows };
}

export function Select({
  value,
  defaultValue,
  onChange,
  onClick,
  onBlur,
  onFocus,
  autoFocus,
  disabled,
  required,
  name,
  id,
  title,
  style,
  className,
  'aria-label': ariaLabel,
  children,
}: SelectProps) {
  const { options, rows } = useMemo(() => collect(children), [children]);

  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string>(() => String(defaultValue ?? value ?? ''));
  const current = isControlled ? String(value) : internal;

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (autoFocus) buttonRef.current?.focus();
    // autoFocus is a mount-only intent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = options.find((o) => o.value === current);
  const displayLabel = selected ? selected.label : options[0]?.label ?? '';

  const reposition = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: r.width });
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    reposition();
    setActiveIdx(options.findIndex((o) => o.value === current));
    setOpen(true);
  }, [disabled, reposition, options, current]);

  const commit = useCallback(
    (val: string) => {
      if (!isControlled) setInternal(val);
      onChange?.({ target: { value: val }, stopPropagation: () => {} });
      setOpen(false);
    },
    [isControlled, onChange],
  );

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current?.contains(e.target as Node) ||
        popupRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    const onReflow = () => reposition();
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, reposition]);

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      setActiveIdx((prev) => {
        const n = options.length;
        if (n === 0) return -1;
        let i = prev;
        for (let step = 0; step < n; step++) {
          i = (i + dir + n) % n;
          if (!options[i]?.disabled) return i;
        }
        return prev;
      });
    },
    [options],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIdx >= 0 && !options[activeIdx]?.disabled) commit(options[activeIdx].value);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIdx(options.findIndex((o) => !o.disabled));
        break;
      case 'End':
        e.preventDefault();
        for (let i = options.length - 1; i >= 0; i--) {
          if (!options[i].disabled) {
            setActiveIdx(i);
            break;
          }
        }
        break;
    }
  };

  return (
    <div ref={containerRef} style={{ display: 'contents' }}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        role="combobox"
        className={className ? `bf-select-trigger ${className}` : 'bf-select-trigger'}
        onClick={(e) => {
          onClick?.(e);
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        style={style}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 14, height: 14, flexShrink: 0, stroke: 'currentColor', fill: 'none', strokeWidth: 2, opacity: 0.7 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {name && <input type="hidden" name={name} value={current} required={required} readOnly />}
      {open && rect &&
        createPortal(
          <div
            ref={popupRef}
            id={listboxId}
            role="listbox"
            // Keep focus on the trigger so an inline-edit `onBlur` (commit-on-blur
            // pattern) doesn't fire and close the editor before the option click lands.
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.top,
              minWidth: rect.width,
              maxHeight: 280,
              overflowY: 'auto',
              background: 'var(--panel-drawer-bg, var(--bg-elevated))',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
              zIndex: 100000,
              padding: 4,
            }}
          >
            {rows.map((row, i) => {
              if (row.kind === 'group') {
                return (
                  <div
                    key={`g-${i}`}
                    style={{ padding: '6px 10px 2px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}
                  >
                    {row.label}
                  </div>
                );
              }
              const opt = options[row.index];
              const isSel = opt.value === current;
              const isActive = row.index === activeIdx;
              return (
                <div
                  key={`o-${row.index}`}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={opt.disabled}
                  onMouseEnter={() => !opt.disabled && setActiveIdx(row.index)}
                  onClick={(e) => {
                    if (opt.disabled) return;
                    // Portaled clicks bubble through the React tree to ancestor
                    // card handlers — stop so selecting doesn't trigger them.
                    e.stopPropagation();
                    commit(opt.value);
                  }}
                  style={{
                    padding: '7px 10px',
                    fontSize: 13,
                    borderRadius: 4,
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    color: opt.disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                    background: isSel
                      ? 'var(--surface-coral-soft)'
                      : isActive
                        ? 'var(--surface-interactive)'
                        : 'transparent',
                    fontWeight: isSel ? 600 : 400,
                  }}
                >
                  {opt.label}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
