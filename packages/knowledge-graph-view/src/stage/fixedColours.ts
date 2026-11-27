/**
 * The theme colours a FRAGMENT shader reads: each is resolved on the CPU from the live palette into its own `vec3` uniform,
 * so no fragment program carries the palette array or indexes it with a uniform. A fragment-stage `uPalette[int(uSomeTone)]`
 * made ANGLE's D3D11 compile (D3DCompiler_47) overflow its stack and kill the GPU process on some AMD drivers (VSIX
 * 2026.11.223); a vertex shader's per-instance lookup is unaffected and stays. ONE table, ONE writer: a theme flip is
 * `resolveFixedColours` after `paletteOf`, and a fragment that needs another theme colour adds a row here, never a lookup.
 */

import { Vector3, type IUniform } from 'three';
import type { ThemeTone } from '../scene/themeTokens';
import { toneIndex } from './tones';

/** Uniform name → the theme tone it carries. */
export const FIXED_TONES = {
    uText: 'text', uViolation: 'violation', uChanged: 'changed', uHover: 'lit', uEdge: 'edge',
    uNodeTop: 'nodeTop', uStoreTop: 'storeTop', uBall: 'sel',
} as const satisfies Record<string, ThemeTone>;

export type FixedColourName = keyof typeof FIXED_TONES;
export type FixedColourUniforms = { [K in FixedColourName]: IUniform<Vector3> };

const NAMES = Object.keys(FIXED_TONES) as FixedColourName[];

/** The uniforms, grey until the first palette is written. */
export function fixedColourUniforms(): FixedColourUniforms {
    return Object.fromEntries(NAMES.map((n) => [n, { value: new Vector3(0.5, 0.5, 0.5) }])) as FixedColourUniforms;
}

/** Copies each fixed tone's colour out of the palette (call after every palette write). */
export function resolveFixedColours(palette: readonly Vector3[], into: FixedColourUniforms): void {
    for (const n of NAMES) {
        const c = palette[toneIndex(FIXED_TONES[n])];
        if (c) into[n].value.copy(c);
    }
}
