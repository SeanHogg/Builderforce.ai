import { readLocal, writeLocal } from '@/lib/storage';

/**
 * The colour theme — one reader, one writer, one event.
 *
 * `app/ThemeProvider` applies the saved theme after hydration; the toggle button
 * flips it; both used to live in one file under `app/`, which `components/`
 * imported — the one direction the layering rule forbids. The mechanism is
 * neither a route nor a component, so it lives here and both import it.
 */
export type Theme = 'light' | 'dark';

export const THEME_EVENT = 'builderforce-theme-change';
const STORAGE_KEY = 'bf-theme';

/** The theme the reader chose last time, defaulting to dark. */
export function savedTheme(): Theme {
  return readLocal(STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

/** The theme the document is showing right now. */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, persist = true): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (persist) writeLocal(STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}
