import { useCallback, useEffect, useState } from 'react';
import { applyTheme, currentTheme, THEME_EVENT, type Theme } from './theme';

/**
 * The live light/dark choice, and the one way to flip it.
 *
 * `lib/theme.ts` owns the DOM write and the broadcast; this is the React read of
 * it. It exists because a second control now offers the same switch — the header
 * button was joined by a row in the account menu — and "subscribe to
 * THEME_EVENT, seed from `currentTheme()`, toggle to the other one" written
 * twice is two chances for one of them to stop tracking the other.
 *
 * Seeds as `dark` for the server frame (there is no document to ask) and syncs on
 * mount, which is what the toggle has always done.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
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

  return { theme, toggle };
}
