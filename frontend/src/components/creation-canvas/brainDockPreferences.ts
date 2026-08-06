/**
 * Brain dock preferences — where the ONE Brain chat lives and how much it shows.
 *
 * The Canvas used to present three separate Brain surfaces (the Object transcript,
 * the details panel transcript, and the floating prompt). Users could not tell how
 * they related, so the conversation is consolidated into a single Brain surface.
 *
 * That surface has THREE placements, because people work at different zoom levels:
 *   - floating: a small card sitting ON the canvas, claiming none of the board
 *   - docked left / docked right: a full-height edge panel the board makes room for
 * Either placement is dragged to any width between MIN and MAX.
 *
 * The prompt is deliberately NOT part of this. It stays in the centre of the page,
 * bottom-aligned, because that is where every chat product people already use puts
 * it — moving it into the side panel is what made the Canvas feel unfamiliar.
 *
 * Every choice is stored here and reported as an activity signal so the product
 * default can be set from what people actually pick rather than from a guess.
 */

export type BrainDockSide = 'left' | 'right';
export type BrainDockMode = 'docked' | 'floating';
export type BrainDockSize = 'slim' | 'expanded';

export interface BrainDockPreferences {
  /** Floating sits on the board; docked claims the edge and reserves its width. */
  mode: BrainDockMode;
  side: BrainDockSide;
  size: BrainDockSize;
  /** Width the user dragged to, in px. Null keeps the size preset. */
  width: number | null;
  /** When false the transcript hides tool/LLM steps and only narrates progress. */
  showExecutionDetail: boolean;
  open: boolean;
}

export const BRAIN_DOCK_STORAGE_KEY = 'builderforce:create:brain-dock';

export const DEFAULT_BRAIN_DOCK_PREFERENCES: BrainDockPreferences = {
  mode: 'docked',
  side: 'right',
  size: 'slim',
  width: null,
  showExecutionDetail: false,
  open: true,
};

/** Preset widths, per size. A drag overrides these; the preset restores them. */
export const BRAIN_DOCK_WIDTH: Record<BrainDockSize, number> = { slim: 330, expanded: 520 };
export const BRAIN_DOCK_MIN_WIDTH = 260;
export const BRAIN_DOCK_MAX_WIDTH = 760;

export function clampBrainDockWidth(width: number): number {
  if (!Number.isFinite(width)) return BRAIN_DOCK_WIDTH.slim;
  return Math.round(Math.min(BRAIN_DOCK_MAX_WIDTH, Math.max(BRAIN_DOCK_MIN_WIDTH, width)));
}

/** The width the surface renders at, whether it came from a preset or a drag. */
export function brainDockWidth(preferences: Pick<BrainDockPreferences, 'size' | 'width'>): number {
  return clampBrainDockWidth(preferences.width ?? BRAIN_DOCK_WIDTH[preferences.size]);
}

/**
 * The width the board gives up. A floating Brain overlays the canvas and a closed
 * one is not there at all, so only a docked Brain pushes the board in.
 */
export function brainDockReservedWidth(preferences: BrainDockPreferences): number {
  return preferences.open && preferences.mode === 'docked' ? brainDockWidth(preferences) : 0;
}

export function sanitizeBrainDockPreferences(value: unknown): BrainDockPreferences {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    mode: record.mode === 'floating' ? 'floating' : 'docked',
    side: record.side === 'left' ? 'left' : 'right',
    size: record.size === 'expanded' ? 'expanded' : 'slim',
    width: typeof record.width === 'number' && Number.isFinite(record.width) ? clampBrainDockWidth(record.width) : null,
    showExecutionDetail: record.showExecutionDetail === true,
    open: record.open !== false,
  };
}

export function readBrainDockPreferences(): BrainDockPreferences {
  if (typeof window === 'undefined') return DEFAULT_BRAIN_DOCK_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(BRAIN_DOCK_STORAGE_KEY);
    return raw ? sanitizeBrainDockPreferences(JSON.parse(raw)) : DEFAULT_BRAIN_DOCK_PREFERENCES;
  } catch {
    return DEFAULT_BRAIN_DOCK_PREFERENCES;
  }
}

export function writeBrainDockPreferences(preferences: BrainDockPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BRAIN_DOCK_STORAGE_KEY, JSON.stringify(preferences));
  } catch { /* storage can be unavailable in hardened contexts */ }
}
