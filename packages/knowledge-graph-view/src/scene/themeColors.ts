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

/** token → the existing token it falls back to. */
export const KG_TOKENS = {
    bg: ['--kg-bg', '--bf-surface'],
    panel: ['--kg-panel', '--bf-surface-2'],
    text: ['--kg-text', '--bf-text'],
    muted: ['--kg-muted', '--bf-text-muted'],
    border: ['--kg-border', '--bf-border'],
    accent: ['--kg-accent', '--bf-accent'],
    accentSoft: ['--kg-accent-soft', '--bf-accent-soft'],
    onAccent: ['--kg-on-accent', '--bf-on-accent'],
    nodeFile: ['--kg-node-file', '--bf-accent'],
    nodeSection: ['--kg-node-section', '--bf-link'],
    nodeSymbol: ['--kg-node-symbol', '--bf-text-secondary'],
    nodeEntity: ['--kg-node-entity', '--bf-success'],
    nodeClaim: ['--kg-node-claim', '--bf-warning'],
    nodeFact: ['--kg-node-fact', '--bf-text-secondary'],
    nodeMissing: ['--kg-node-missing', '--bf-danger'],
    edge: ['--kg-edge', '--bf-border-strong'],
    violation: ['--kg-violation', '--bf-danger'],
    cycle: ['--kg-cycle', '--bf-warning'],
    duplicate: ['--kg-duplicate', '--bf-warning'],
    contradicts: ['--kg-contradicts', '--bf-danger'],
    agrees: ['--kg-agrees', '--bf-success'],
    stale: ['--kg-stale', '--bf-text-muted'],
    unused: ['--kg-unused', '--bf-text-muted'],
    changed: ['--kg-changed', '--bf-accent'],
    plane: ['--kg-plane', '--bf-surface-2'],
    warnBg: ['--kg-warn-bg', '--bf-warning-bg'],
    errorText: ['--kg-error', '--bf-error'],
} as const satisfies Record<string, readonly [string, string]>;

export type ThemeTone = keyof typeof KG_TOKENS;
export type ThemeColors = Record<ThemeTone, string>;

const TONES = Object.keys(KG_TOKENS) as ThemeTone[];

/** `var(--kg-x, var(--bf-y, currentColor))` — the DOM resolves it, so both themes read. */
export function cssVar(tone: ThemeTone): string {
    const [own, fallback] = KG_TOKENS[tone];
    return `var(${own}, var(${fallback}, currentColor))`;
}

/** Any CSS colour → `rgb(r, g, b)` via a 1×1 canvas, so three.js never sees oklch()/color-mix(). */
function toRgb(color: string, ctx: CanvasRenderingContext2D | null): string {
    if (!ctx || !color) return color;
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

/** Theme colours for `el`, re-read when the theme flips. Null until the element mounts. */
export function useThemeColors(el: Element | null): ThemeColors | null {
    const [colors, setColors] = useState<ThemeColors | null>(null);
    useEffect(() => {
        if (!el) return undefined;
        const read = () => setColors(readThemeColors(el));
        read();
        const observer = new MutationObserver(read);
        for (const target of [document.documentElement, document.body]) {
            observer.observe(target, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
        }
        const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
        media?.addEventListener?.('change', read);
        return () => {
            observer.disconnect();
            media?.removeEventListener?.('change', read);
        };
    }, [el]);
    return colors;
}
