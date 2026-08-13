import { DEFAULT_STROKE_COLOR, DEFAULT_STROKE_WIDTH, DRAWING_TOOLS, type CanvasDrawingTool } from '@/lib/canvasDrawing';

/**
 * Which pen you picked up, remembered.
 *
 * Colour and width used to be inspector fields you could only reach AFTER
 * drawing something in the default blue — which is backwards: you choose a pen
 * and then draw with it. They are chosen before the stroke now, and they persist,
 * because a person marking up a board makes twenty marks in a row and should
 * choose once. Mirrors `brainDockPreferences` deliberately: same storage shape,
 * same defensive read, so there is one way canvas preferences behave.
 */

export interface DrawingPreferences {
  tool: CanvasDrawingTool;
  color: string;
  width: number;
}

export const DEFAULT_DRAWING_PREFERENCES: DrawingPreferences = {
  tool: 'pen',
  color: DEFAULT_STROKE_COLOR,
  width: DEFAULT_STROKE_WIDTH,
};

const STORAGE_KEY = 'builderforce.canvas.drawing';

export function readDrawingPreferences(): DrawingPreferences {
  if (typeof window === 'undefined') return DEFAULT_DRAWING_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_DRAWING_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<DrawingPreferences>;
    return {
      tool: DRAWING_TOOLS.includes(parsed.tool as CanvasDrawingTool) ? parsed.tool as CanvasDrawingTool : DEFAULT_DRAWING_PREFERENCES.tool,
      color: typeof parsed.color === 'string' && parsed.color.length < 64 ? parsed.color : DEFAULT_DRAWING_PREFERENCES.color,
      width: typeof parsed.width === 'number' && parsed.width >= 1 && parsed.width <= 24 ? parsed.width : DEFAULT_DRAWING_PREFERENCES.width,
    };
  } catch {
    return DEFAULT_DRAWING_PREFERENCES;
  }
}

export function writeDrawingPreferences(preferences: DrawingPreferences): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* private mode: the session still draws */ }
}
