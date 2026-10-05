import { useMemo } from 'react';
import type { CanvasPhase } from '@/lib/canvasPhases';

/**
 * A phase's hue as a colour three.js can take — the `--stage-<phase>` token, resolved.
 *
 * A material cannot read a CSS custom property, so the room resolves the token once per
 * phase the way `EvermindBrain3D` resolves its region hues: off the document's computed
 * style, which carries the active theme. Null outside a browser or when the token reads
 * empty — the caller then draws the station unlit rather than in a literal colour that
 * would look the same in both themes.
 */
export function useStageHue(phase: CanvasPhase | undefined): string | null {
  return useMemo(() => {
    if (!phase || typeof document === 'undefined') return null;
    return getComputedStyle(document.documentElement).getPropertyValue(`--stage-${phase}`).trim() || null;
  }, [phase]);
}
