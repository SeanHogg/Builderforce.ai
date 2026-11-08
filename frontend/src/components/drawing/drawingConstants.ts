import type { CanvasDrawingTool } from '@/lib/canvasDrawing';

/** One glyph per tool, so the tray is scannable without reading it. The label
 *  stays beside it — an icon-only pen tray is a memory test. */
export const DRAWING_TOOL_GLYPH: Readonly<Record<CanvasDrawingTool, string>> = {
  pen: '✎', highlighter: '▬', line: '╱', rect: '▭', ellipse: '◯', text: 'T', eraser: '⌫',
};
