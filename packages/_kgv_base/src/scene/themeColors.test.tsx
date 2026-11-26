// @vitest-environment jsdom
/** Theme tokens resolve against the host's custom properties, and a re-read only yields a new object when a tone moves. */
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { cssVar, KG_TOKENS, readThemeColors, sameThemeColors, useThemeColors } from './themeColors';

const flushFrames = async (): Promise<void> => {
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
};

afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('class');
    document.body.removeAttribute('style');
});

describe('readThemeColors', () => {
    it('reads the own token first, then the fallback token, then the text colour', () => {
        const el = document.createElement('div');
        el.style.setProperty('--kg-accent', 'rgb(1, 2, 3)');
        el.style.setProperty('--bf-surface', 'rgb(4, 5, 6)');
        el.style.color = 'rgb(7, 8, 9)';
        document.body.appendChild(el);
        const colors = readThemeColors(el);
        expect(colors.accent).toBe('rgb(1, 2, 3)');
        expect(colors.bg).toBe('rgb(4, 5, 6)');
        expect(colors.text).toBe('rgb(7, 8, 9)');
        expect(Object.keys(colors).sort()).toEqual(Object.keys(KG_TOKENS).sort());
        el.remove();
    });

    it('cssVar chains the own token, the fallback and currentColor', () => {
        expect(cssVar('accent')).toBe('var(--kg-accent, var(--bf-accent, currentColor))');
    });
});

describe('sameThemeColors', () => {
    it('compares tone by tone', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const a = readThemeColors(el);
        expect(sameThemeColors(a, { ...a })).toBe(true);
        expect(sameThemeColors(a, { ...a, accent: 'rgb(9, 9, 9)' })).toBe(false);
        expect(sameThemeColors(null, a)).toBe(false);
        el.remove();
    });
});

describe('useThemeColors', () => {
    it('regression: style-only change does not repaint (the same object survives a scroll-lock)', async () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const { result } = renderHook(() => useThemeColors(el));
        await waitFor(() => expect(result.current).not.toBeNull());
        const first = result.current;
        act(() => { document.body.style.overflow = 'hidden'; document.body.style.cursor = 'grabbing'; });
        await flushFrames();
        expect(result.current).toBe(first);
        el.remove();
    });

    it('yields new colours when a token really changes', async () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const { result } = renderHook(() => useThemeColors(el));
        await waitFor(() => expect(result.current).not.toBeNull());
        const first = result.current;
        // jsdom does not inherit custom properties, so the token lands on the element and a theme-class flip announces it.
        act(() => { el.style.setProperty('--kg-accent', 'rgb(10, 20, 30)'); document.documentElement.className = 'dark'; });
        await waitFor(() => expect(result.current?.accent).toBe('rgb(10, 20, 30)'));
        expect(result.current).not.toBe(first);
        el.remove();
    });

    it('is null without an element', () => {
        const { result } = renderHook(() => useThemeColors(null));
        expect(result.current).toBeNull();
    });
});
