import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { applyTheme, currentTheme, THEME_EVENT, type Theme } from '@/lib/theme';

/**
 * ThemeToggleButton — drop into any nav/header. Mounted only inside client
 * boundaries (the marketing header, the top bar, the auth pages).
 */
export function ThemeToggleButton({ className }: { className?: string }) {
  const t = useTranslations('marketingNav');
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const sync = (event?: Event) => {
      setTheme(event instanceof CustomEvent ? (event.detail as Theme) : currentTheme());
    };
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const toggle = useCallback(() => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
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
