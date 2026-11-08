import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { readThemeColors, themeScope, useThemeColors } from './useThemeColors';

const TOKENS = { background: '--canvas-board', accent: '--canvas-accent' } as const;

/** Tokens live on the shell only: the document root answers nothing, like the real stylesheet. */
function mockComputedStyle(values: () => Record<string, string>) {
  const original = window.getComputedStyle.bind(window);
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    if (element.hasAttribute('data-canvas-shell')) return { getPropertyValue: (name: string) => values()[name] ?? '' } as CSSStyleDeclaration;
    return original(element, pseudo);
  });
}

function Probe({ anchor, onColors }: { anchor: RefObject<HTMLDivElement | null>; onColors: (colors: Record<string, string>) => void }) {
  onColors(useThemeColors(TOKENS, anchor));
  return <div ref={anchor} />;
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('useThemeColors', () => {
  it('resolves the shell the element sits in, not the document root', () => {
    const shell = document.createElement('section');
    shell.setAttribute('data-canvas-shell', '');
    const inner = document.createElement('div');
    shell.append(inner);
    document.body.append(shell);
    expect(themeScope(inner)).toBe(shell);
    expect(themeScope(document.createElement('div'))).toBe(document.documentElement);
    expect(themeScope(null)).toBe(document.documentElement);
  });

  it('reads the --canvas-* tokens from the shell and falls back for a token that reads empty', () => {
    const shell = document.createElement('section');
    shell.setAttribute('data-canvas-shell', '');
    mockComputedStyle(() => ({ '--canvas-board': ' #F1F5F9 ' }));
    expect(readThemeColors(TOKENS, shell)).toEqual({ background: '#F1F5F9', accent: 'gray' });
  });

  it('follows the shell when its theme flips', async () => {
    let theme: Record<string, string> = { '--canvas-board': '#F1F5F9', '--canvas-accent': '#e04e3c' };
    mockComputedStyle(() => theme);
    const shell = document.createElement('section');
    shell.setAttribute('data-canvas-shell', '');
    document.body.append(shell);
    const anchor = createRef<HTMLDivElement>();
    const seen: Array<Record<string, string>> = [];
    const view = render(<Probe anchor={anchor} onColors={(colors) => seen.push(colors)} />, { container: shell.appendChild(document.createElement('div')) });
    expect(seen[seen.length - 1]).toEqual({ background: '#F1F5F9', accent: '#e04e3c' });

    theme = { '--canvas-board': '#09111f', '--canvas-accent': '#3978f6' };
    await act(async () => { shell.className = 'dark'; await Promise.resolve(); });
    expect(seen[seen.length - 1]).toEqual({ background: '#09111f', accent: '#3978f6' });
    view.unmount();
  });
});
