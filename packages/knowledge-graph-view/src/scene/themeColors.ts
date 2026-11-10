/**
 * The view's colours are TOKENS, never literals: `--kg-*`, each falling back to an
 * existing shared token (`--bf-*`, the brain-ui palette every host already defines — the
 * web app, the VS Code webview and Rovr). DOM chrome reads them with `cssVar()` (a
 * `var()` chain the browser resolves); the WebGL scene cannot, so `readThemeColors`
 * resolves each one through `getComputedStyle` to concrete RGB, and `useThemeColors`
 * re-reads them whenever the theme changes (a class/attribute flip on `<html>`/`<body>`
 * or the OS colour scheme).
 */

import { useEffect, useState } from 'react';
import { KG_TOKENS, type ThemeColors, type ThemeTone } from './themeTokens';

// The tokens themselves are pure data in `themeTokens.ts` (the worker imports them without React).
export { KG_TOKENS, type ThemeColors, type ThemeTone };

const TONES = Object.keys(KG_TOKENS) as ThemeTone[];

/** `var(--kg-x, var(--bf-y, currentColor))` — the DOM resolves it, so both themes read. */
export function cssVar(tone: ThemeTone): string {
    const [own, fallback] = KG_TOKENS[tone];
    return `var(${own}, var(${fallback}, currentColor))`;
}

/** Any CSS colour → `rgb(r, g, b)` via a 1×1 canvas, so three.js never sees oklch()/color-mix(). */
function toRgb(color: string, ctx: CanvasRenderingContext2D | null): string {
    // Some hosts/tests hand back a partial 2D context; an incomplete one cannot convert, so pass the colour through.
    if (!ctx || !color || typeof ctx.clearRect !== 'function' || typeof ctx.fillRect !== 'function' || typeof ctx.getImageData !== 'function') return color;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
}

/** Resolves every tone against `el`'s computed style. Missing tokens fall back to the text colour. */
export function readThemeColors(el: Element): ThemeColors {
    const style = getComputedStyle(el);
    const text = style.color;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
    } catch { ctx = null; }
    const out = {} as ThemeColors;
    for (const tone of TONES) {
        const [own, fallback] = KG_TOKENS[tone];
        const raw = style.getPropertyValue(own).trim() || style.getPropertyValue(fallback).trim() || text;
        out[tone] = toRgb(raw, ctx);
    }
    return out;
}

/** True when every tone resolves to the same colour in both readings. */
export function sameThemeColors(a: ThemeColors | null, b: ThemeColors | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return TONES.every((tone) => a[tone] === b[tone]);
}

/**
 * Theme colours for `el`, re-read when the theme flips. Null until the element mounts.
 *
 * `style` stays observed (a host may set the tokens inline on `<html>`), but an inline-style change
 * that moves no tone — a modal's `overflow` scroll-lock, a drag cursor — keeps the SAME object, so the
 * canvas and the WebGL materials keyed on it do not repaint. A burst of mutations is coalesced into
 * one read per animation frame.
 */
export function useThemeColors(el: Element | null): ThemeColors | null {
    const [colors, setColors] = useState<ThemeColors | null>(null);
    useEffect(() => {
        if (!el) return undefined;
        const read = () => {
            const next = readThemeColors(el);
            setColors((prev) => (sameThemeColors(prev, next) ? prev : next));
        };
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
        let frame: number | null = null;
        const schedule = () => {
            if (!raf) { read(); return; }
            if (frame !== null) return;
            frame = raf(() => { frame = null; read(); });
        };
        read();
        const observer = new MutationObserver(schedule);
        for (const target of [document.documentElement, document.body]) {
            observer.observe(target, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
        }
        const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
        media?.addEventListener?.('change', schedule);
        return () => {
            observer.disconnect();
            media?.removeEventListener?.('change', schedule);
            if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        };
    }, [el]);
    return colors;
}
