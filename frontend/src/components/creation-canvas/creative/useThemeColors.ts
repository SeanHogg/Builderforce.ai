import { useEffect, useState, type RefObject } from 'react';

/**
 * Theme tokens as concrete colours, for the surfaces CSS cannot reach: a `<canvas>`
 * 2D context and a three.js scene take a colour STRING, not a `var(--token)`.
 *
 * The `--canvas-*` tokens are declared on the board shell (`[data-canvas-shell]`), not on
 * the document root, so they are read from the shell the calling element sits in (and
 * from the root only when it sits in none, e.g. a standalone preview). Read at mount and
 * again whenever the theme can have flipped: the shell's `class`/`style`, the root's
 * `class`/`data-theme`, or the OS colour scheme. A token that reads empty falls back to
 * `fallback` — a neutral keyword, never a hex that would look the same in both themes.
 *
 * Name a token whose value is a plain colour: a three.js background cannot parse a
 * gradient, which is why a scene wants `--canvas-board`, not `--canvas-board-background`.
 */
export const THEME_SCOPE_SELECTOR = '[data-canvas-shell]';

/** The element the tokens are declared on for something mounted at `element`. */
export function themeScope(element: Element | null | undefined): Element {
  return element?.closest(THEME_SCOPE_SELECTOR) ?? document.documentElement;
}

export function readThemeColors<Key extends string>(tokens: Record<Key, string>, scope: Element = document.documentElement, fallback = 'gray'): Record<Key, string> {
  const style = getComputedStyle(scope);
  return Object.fromEntries((Object.entries(tokens) as Array<[Key, string]>).map(([key, token]) => [key, style.getPropertyValue(token).trim() || fallback])) as Record<Key, string>;
}

/** `anchor` is any element rendered inside the board (a ref on the editor's root). */
export function useThemeColors<Key extends string>(tokens: Record<Key, string>, anchor: RefObject<Element | null>, fallback = 'gray'): Record<Key, string> {
  const [colors, setColors] = useState<Record<Key, string>>(() => Object.fromEntries((Object.keys(tokens) as Key[]).map((key) => [key, fallback])) as Record<Key, string>);
  // `tokens` is a literal at each call site; key it by content so a new object each render does not re-read.
  const signature = JSON.stringify(tokens);
  useEffect(() => {
    const scope = themeScope(anchor.current);
    const read = () => setColors(readThemeColors(JSON.parse(signature) as Record<Key, string>, scope, fallback));
    read();
    const observer = new MutationObserver(read);
    observer.observe(scope, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    if (scope !== document.documentElement) observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    const scheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    scheme?.addEventListener('change', read);
    return () => { observer.disconnect(); scheme?.removeEventListener('change', read); };
  }, [signature, fallback, anchor]);
  return colors;
}
