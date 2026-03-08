'use client';

import { useEffect, useCallback } from 'react';

/**
 * ThemeProvider — injects FOUC-prevention logic on mount.
 * Does NOT render a visible button — the toggle button is embedded
 * directly in each page's nav via the `ThemeToggleButton` export below.
 */
export default function ThemeProvider() {
    useEffect(() => {
        // Sync the icon(s) immediately after hydration
        const saved = localStorage.getItem('bf-theme');
        const theme = saved === 'light' ? 'light' : 'dark';
        applyTheme(theme, false);
    }, []);

    return null; // No rendered output — just the side-effect
}

function applyTheme(theme: 'light' | 'dark', persist = true) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (persist) localStorage.setItem('bf-theme', theme);
    // Update any mounted toggle icons
    document.querySelectorAll<HTMLElement>('[data-theme-icon]').forEach(el => {
        el.textContent = theme === 'dark' ? '☀' : '☾';
        el.closest('button')?.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
}

/**
 * ThemeToggleButton — drop into any nav/header.
 *
 * Usage:
 *   import { ThemeToggleButton } from './ThemeProvider';
 *   <ThemeToggleButton />
 */
export function ThemeToggleButton({ className }: { className?: string }) {
    const toggle = useCallback(() => {
        const next =
            document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
    }, []);

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label="Switch to light mode"
            title="Toggle light / dark"
            className={className}
            style={{
                display: 'grid',
                placeItems: 'center',
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface-card-strong)',
                backdropFilter: 'blur(10px)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                color: 'var(--text-secondary)',
                fontSize: '1rem',
                flexShrink: 0,
            }}
            onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-accent)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)';
                (e.currentTarget as HTMLButtonElement).style.transform = '';
            }}
        >
            <span data-theme-icon aria-hidden="true">☀</span>
        </button>
    );
}
