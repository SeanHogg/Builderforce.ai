import { isSafeStrokeColor, DEFAULT_STROKE_COLOR, DEFAULT_STROKE_WIDTH, DRAWING_TOOLS, type CanvasDrawingTool } from '@/lib/canvasDrawing';
import { readLocalJson, writeLocalJson } from '@/lib/storage';

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
  const parsed = readLocalJson<Partial<DrawingPreferences>>(STORAGE_KEY);
  if (!parsed || typeof parsed !== 'object') return DEFAULT_DRAWING_PREFERENCES;
  return {
    tool: DRAWING_TOOLS.includes(parsed.tool as CanvasDrawingTool) ? parsed.tool as CanvasDrawingTool : DEFAULT_DRAWING_PREFERENCES.tool,
    color: isSafeStrokeColor(parsed.color) ? parsed.color : DEFAULT_DRAWING_PREFERENCES.color,
    width: typeof parsed.width === 'number' && parsed.width >= 1 && parsed.width <= 24 ? parsed.width : DEFAULT_DRAWING_PREFERENCES.width,
  };
}

/** A failed write (private mode, quota) is fine: the session still draws. */
export function writeDrawingPreferences(preferences: DrawingPreferences): void {
  writeLocalJson(STORAGE_KEY, preferences);
}
