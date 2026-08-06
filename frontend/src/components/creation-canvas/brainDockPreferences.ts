/**
 * Brain dock preferences — where the ONE Brain chat lives and how much it shows.
 *
 * The Canvas used to present three separate Brain surfaces (the Object transcript,
 * the details panel transcript, and the floating prompt). Users could not tell how
 * they related, so they are consolidated into a single dock that the user parks on
 * the left OR the right, slim or expanded. The chosen layout is stored here and
 * reported as an activity signal so the product default can be set from what people
 * actually pick rather than from a guess.
 */

export type BrainDockSide = 'left' | 'right';
export type BrainDockSize = 'slim' | 'expanded';

export interface BrainDockPreferences {
  side: BrainDockSide;
  size: BrainDockSize;
  /** When false the transcript hides tool/LLM steps and only narrates progress. */
  showExecutionDetail: boolean;
  open: boolean;
}

export const BRAIN_DOCK_STORAGE_KEY = 'builderforce:create:brain-dock';

export const DEFAULT_BRAIN_DOCK_PREFERENCES: BrainDockPreferences = {
  side: 'right',
  size: 'slim',
  showExecutionDetail: false,
  open: true,
};

/** Widths the dock reserves from the canvas, per size. Mirrored in the stylesheet. */
export const BRAIN_DOCK_WIDTH: Record<BrainDockSize, number> = { slim: 330, expanded: 520 };

export function sanitizeBrainDockPreferences(value: unknown): BrainDockPreferences {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    side: record.side === 'left' ? 'left' : 'right',
    size: record.size === 'expanded' ? 'expanded' : 'slim',
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
