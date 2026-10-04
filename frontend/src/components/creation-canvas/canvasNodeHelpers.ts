import type { CreationFlowNode } from './CreationNode';
import { makeSpecDeriveBoard } from '@/lib/specObjects';
import type { CreationNodeData, CreationObjectKind } from './types';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import { createDefaultCreationData } from './creationObjectRegistry';
import { type CanvasDrawingTool, canvasStrokes } from '@/lib/canvasDrawing';
import { objectAtPoint } from '@/domains/canvas/domain/canvasBoard';
import { canvasNodeDimensions } from './creationCanvasLayout';
import { CREATIVE_CAPABILITIES } from '@builderforce/creation-canvas-contract';

/**
 * The board a computed field reads, indexed once per snapshot.
 *
 * Every `contextAdapter` call below takes one, because a `gradebook`'s mean and a
 * `submission`'s lateness are computed from the objects NEXT TO them — a snapshot built
 * without the board hands the model a card the user can see numbers on and it cannot,
 * which is the authorable-but-unreadable drift `creationObjectContext` exists to stop,
 * in its mirror image.
 *
 * Built per INVOCATION rather than per render: these are tool calls, not frames, and
 * indexing N objects once inside a call is O(N) where indexing per object would be
 * O(N²) — the fan-out shape the platform rejects.
 */
export function specBoardOf(source: readonly CreationFlowNode[]) {
  return makeSpecDeriveBoard(source.map((node) => node.data as unknown as Record<string, unknown>));
}

export function newNode(kind: CreationObjectKind, position: { x: number; y: number }, t?: CanvasTextTranslator): CreationFlowNode {
  return { id: crypto.randomUUID(), type: 'creation', position, data: createDefaultCreationData(kind, t) };
}

/**
 * Restyle every mark on a drawing at once.
 *
 * Geometry is deliberately untouched: the strokes are already relative to their
 * own card, so re-normalizing them here would move the card by a pixel every
 * time somebody dragged the colour slider. `stroke` / `strokeWidth` are kept in
 * step on the object because they are what a pre-strokes client reads.
 */
export function restyleDrawing(data: CreationNodeData, style: { stroke?: string; strokeWidth?: number }): Partial<CreationNodeData> {
  const strokes = canvasStrokes(data).map((stroke) => ({ ...stroke, ...style }));
  return { strokes, ...style } as Partial<CreationNodeData>;
}

/** One glyph per tool, so the tray is scannable without reading it. The label
 *  stays beside it — an icon-only pen tray is a memory test. */
export const DRAWING_TOOL_GLYPH: Readonly<Record<CanvasDrawingTool, string>> = {
  pen: '✎', highlighter: '▬', line: '╱', rect: '▭', ellipse: '◯', text: 'T', eraser: '⌫',
};

/** `<input type="color">` cannot show a CSS variable, and the default stroke IS
 *  one (so a sketch reads correctly in both themes). The swatch falls back to the
 *  hex of that variable until the user picks a colour of their own. */
export const DRAWING_FALLBACK_HEX = '#4d9eff';

/**
 * The object a point lands on — `objectAtPoint`, given this surface's measurer.
 *
 * The domain deliberately takes the measurer as an argument rather than importing
 * one: an object's drawn size is a PRESENTATION fact (it depends on the renderer
 * and, for auto-sized cards, on the DOM), so a domain that reached for it would
 * make a headless test of the hit rule need a browser. Binding it here is the
 * whole adaptation.
 */
export function topmostNodeAt(nodes: readonly CreationFlowNode[], point: { x: number; y: number }): CreationFlowNode | null {
  return objectAtPoint(nodes, point, canvasNodeDimensions);
}

// The FORMAT NAMES, out of the profiles that now carry the extension, the mime type and
// the adapter that actually produces each one. This read `capability.outputs`, which the
// contract replaced with `outputProfiles` precisely so a format could not be advertised
// with no producer behind it — the list here is still just the names, because that is all
// this map is asked for.
export const CREATIVE_OUTPUTS = Object.fromEntries(CREATIVE_CAPABILITIES.map((capability) => [capability.kind, capability.outputProfiles.map((profile) => profile.format)])) as Partial<Record<CreationObjectKind, readonly string[]>>;
