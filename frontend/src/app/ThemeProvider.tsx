'use client';

import { useEffect, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

type Theme = 'light' | 'dark';
const THEME_EVENT = 'builderforce-theme-change';

/**
 * ThemeProvider — injects FOUC-prevention logic on mount.
 * Does NOT render a visible button — the toggle button is embedded
 * directly in each page's nav via the `ThemeToggleButton` export below.
 */
export default function ThemeProvider() {
    useEffect(() => {
        // Sync the icon(s) immediately after hydration
        const saved = localStorage.getItem('bf-theme');
        const theme: Theme = saved === 'light' ? 'light' : 'dark';
        applyTheme(theme, false);
    }, []);

    return null; // No rendered output — just the side-effect
}

function applyTheme(theme: Theme, persist = true) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (persist) localStorage.setItem('bf-theme', theme);
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}

/**
 * ThemeToggleButton — drop into any nav/header.
 *
 * Usage:
 *   import { ThemeToggleButton } from './ThemeProvider';
 *   <ThemeToggleButton />
 */
export function ThemeToggleButton({ className }: { className?: string }) {
    const t = useTranslations('marketingNav');
    const [theme, setTheme] = useState<Theme>('dark');

    useEffect(() => {
        const sync = (event?: Event) => {
            const next = event instanceof CustomEvent
                ? event.detail as Theme
                : document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
            setTheme(next);
        };
        sync();
        window.addEventListener(THEME_EVENT, sync);
        return () => window.removeEventListener(THEME_EVENT, sync);
    }, []);

    const toggle = useCallback(() => {
        const next: Theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
    }, []);

    const label = theme === 'dark' ? t('switchToLight') : t('switchToDark');

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={label}
            title={label}
            className={`theme-control${className ? ` ${className}` : ''}`}
        >
            {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></svg>
            ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" /></svg>
            )}
        </button>
    );
}
