/**
 * The view's shared inline styles — tokens only (`cssVar`), so both themes read and the
 * package ships no stylesheet a host would have to load (the VS Code webview loads ONE).
 * Layout that depends on width reads the CONTAINER (`useContainerWidth`), not the
 * viewport: the view is a canvas surface, a webview tab and a side panel.
 * Every control is at least 40px tall — a tap target at 360px.
 */

import type { CSSProperties } from 'react';
import { cssVar, type ThemeTone } from './scene/themeColors';

export const TAP = 40;

/**
 * Density-aware control height: `--kg-control` is 30px on a fine pointer and 40px on a coarse one
 * (tokens.css owns the `@media (pointer: coarse)` switch). The 40px fallback keeps the tap target
 * for any host that has not loaded tokens.css. Works in inline styles, including inside `calc()`.
 */
export const CONTROL = 'var(--kg-control, 40px)';

/** The mono stack; hosts may load JetBrains Mono, the package loads nothing. */
export const MONO = 'var(--kg-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)';

export type LayerId = 'entry' | 'presentation' | 'application' | 'domain' | 'infrastructure' | 'data' | 'other';

const LAYER_TONE: Record<LayerId, ThemeTone> = {
    entry: 'bandEntry', presentation: 'bandPresentation', application: 'bandApplication', domain: 'bandDomain',
    infrastructure: 'bandInfrastructure', data: 'bandData', other: 'bandOther',
};

/** The band colour (a `var()` chain) of an architecture layer. */
export const layerColor = (layer: LayerId): string => cssVar(LAYER_TONE[layer]);

/** Heat ramp colour for a 1..5 level (clamped). */
export const heatColor = (level: number): string => cssVar((['w1', 'w2', 'w3', 'w4', 'w5'] as const)[Math.min(5, Math.max(1, Math.round(level))) - 1]!);

/** Route colour for a 1..4 line. */
export const routeColor = (line: number): string => cssVar((['l1', 'l2', 'l3', 'l4'] as const)[Math.min(4, Math.max(1, Math.round(line))) - 1]!);

export const button: CSSProperties = {
    minHeight: TAP, minWidth: TAP, padding: '0 14px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text'),
    font: 'inherit', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
};

export const primaryButton: CSSProperties = {
    ...button, background: cssVar('accent'), color: cssVar('onAccent'), borderColor: cssVar('accent'),
};

export const quietButton: CSSProperties = { ...button, background: 'transparent' };

export const chip = (active: boolean): CSSProperties => ({
    ...button, flex: 'none', fontWeight: active ? 700 : 500,
    background: active ? cssVar('accentSoft') : 'transparent',
    borderColor: active ? cssVar('accent') : cssVar('border'),
    color: cssVar('text'),
});

export const card: CSSProperties = {
    border: `1px solid ${cssVar('border')}`, borderRadius: 10, background: cssVar('panel'), padding: 12,
};

export const muted: CSSProperties = { color: cssVar('muted'), fontSize: 12 };

export const heading: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700, color: cssVar('text') };

export const input: CSSProperties = {
    minHeight: TAP, padding: '0 12px', borderRadius: 8, border: `1px solid ${cssVar('border')}`,
    background: cssVar('bg'), color: cssVar('text'), font: 'inherit', fontSize: 13, minWidth: 0,
};

export const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 };

export const swatch = (tone: string): CSSProperties => ({
    display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: tone, flex: 'none',
});
