import { useTranslations } from 'next-intl';
import { useTheme } from '@/lib/useTheme';

/**
 * ThemeToggleButton — drop into any nav/header. Mounted only inside client
 * boundaries (the marketing header, the auth pages). The signed-in top bar
 * offers the same switch as a row in the account menu instead; both read the
 * one `useTheme()` hook, so neither can drift out of sync with the document.
 */
export function ThemeToggleButton({ className }: { className?: string }) {
  const t = useTranslations('marketingNav');
  const { theme, toggle } = useTheme();

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
