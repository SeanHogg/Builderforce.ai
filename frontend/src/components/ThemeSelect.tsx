'use client';

import { useRef, useEffect, useState } from 'react';

export interface ThemeSelectOption {
  value: string;
  label: string;
}

export interface ThemeSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ThemeSelectOption[];
  /** Optional label for aria */
  ariaLabel?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Theme-aware dropdown. Uses theme CSS variables for list background and text
 * so options are readable in both light and dark mode (native <select> often
 * ignores option styling in the browser’s dropdown).
 */
export function ThemeSelect({
  value,
  onChange,
  options,
  ariaLabel,
  style,
  className,
}: ThemeSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = (selected?.label ?? value) || '';

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
        return;
      }
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handle);
    };
  }, [open]);

  const baseStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 8px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    textAlign: 'left',
    cursor: 'pointer',
    ...style,
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: style?.width ?? '100%' }} className={className}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="theme-select-listbox"
        role="combobox"
        onClick={() => setOpen((o) => !o)}
        style={baseStyle}
      >
        {label || ' '}
      </button>
      {open && (
        <div
          id="theme-select-listbox"
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 2,
            maxHeight: 240,
            overflow: 'auto',
            background: 'var(--panel-drawer-bg)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            zIndex: 1000,
          }}
        >
          {options.map((opt) => (
            <div
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{
                padding: '8px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: opt.value === value ? 'var(--surface-coral-soft)' : 'transparent',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => {
                if (opt.value !== value) {
                  e.currentTarget.style.background = 'var(--surface-interactive)';
                }
              }}
              onMouseLeave={(e) => {
                if (opt.value !== value) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
