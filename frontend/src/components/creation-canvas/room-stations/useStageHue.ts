import type { CanvasPhase } from '@/lib/canvasPhases';
import { useTheme } from '@/lib/useTheme';

/**
 * A phase's hue as a colour three.js can take — the `--stage-<phase>` token, resolved.
 *
 * A material cannot read a CSS custom property, so the room resolves the token the way
 * `EvermindBrain3D` resolves its region hues: off the document's computed style, which
 * carries the active theme. Null outside a browser or when the token reads empty — the
 * caller then draws the station unlit rather than in a literal colour that would look the
 * same in both themes.
 *
 * Read on every render rather than memoised: the token's VALUE changes with the theme, and
 * `useTheme` re-renders this when the reader toggles — a memo keyed on the phase alone kept
 * a lit station in the hue of the theme it was first drawn in. Only the one lit station
 * passes a phase, so this is a single style read.
 */
export function useStageHue(phase: CanvasPhase | undefined): string | null {
  useTheme();
  if (!phase || typeof document === 'undefined') return null;
  return getComputedStyle(document.documentElement).getPropertyValue(`--stage-${phase}`).trim() || null;
}
