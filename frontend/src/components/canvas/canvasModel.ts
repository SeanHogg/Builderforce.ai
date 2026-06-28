/**
 * Canvas document model — the shared, serialisable shape behind the reusable
 * <CanvasBoard>. A canvas is a free-form board of absolutely-positioned blocks
 * (text, sticky notes, images, embedded knowledge docs, and collaborative
 * timer/stopwatch widgets), à la Miro/Mural.
 *
 * It is stored INSIDE the existing knowledge `content` string (prefixed with a
 * sentinel) so versioning, publishing and the realtime collab transport keep
 * working unchanged — no schema migration. The same model is reused by the
 * Brain / Brainstorm slide-out, which is why this lives in components/canvas and
 * not under the knowledge route.
 *
 * Widget liveness is collaborative by construction: a running timer/stopwatch
 * stores `startedAt` (epoch ms) + the accumulated base, so every viewer derives
 * the SAME elapsed value from the shared model instead of a private local clock.
 */

export type CanvasBlockType = 'text' | 'sticky' | 'image' | 'embed' | 'timer' | 'stopwatch';

export interface CanvasBlockBase {
  id: string;
  type: CanvasBlockType;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextBlock extends CanvasBlockBase {
  type: 'text';
  /** Markdown. */
  text: string;
}
export interface StickyBlock extends CanvasBlockBase {
  type: 'sticky';
  text: string;
  color: string;
}
export interface ImageBlock extends CanvasBlockBase {
  type: 'image';
  url: string;
  alt?: string;
}
export interface EmbedBlock extends CanvasBlockBase {
  type: 'embed';
  /** Transcluded knowledge document id. */
  documentId: string;
  title?: string;
}
export interface TimerBlock extends CanvasBlockBase {
  type: 'timer';
  /** Configured countdown length. */
  durationMs: number;
  /** Epoch ms the current run started, or null when paused/stopped. */
  startedAt: number | null;
  /** Already-elapsed ms accumulated before the current run. */
  baseElapsedMs: number;
  label?: string;
}
export interface StopwatchBlock extends CanvasBlockBase {
  type: 'stopwatch';
  startedAt: number | null;
  baseElapsedMs: number;
  label?: string;
}

export type CanvasBlock = TextBlock | StickyBlock | ImageBlock | EmbedBlock | TimerBlock | StopwatchBlock;

export interface CanvasModel {
  version: 1;
  blocks: CanvasBlock[];
}

const SENTINEL = '<!--builderforce:canvas-->';

export function emptyCanvas(): CanvasModel {
  return { version: 1, blocks: [] };
}

/** True if a stored `content` string holds a canvas (vs plain Markdown). */
export function isCanvasContent(content: string | null | undefined): boolean {
  return !!content && content.trimStart().startsWith(SENTINEL);
}

/** Serialise a canvas into the `content` field (sentinel + JSON). */
export function serializeCanvas(model: CanvasModel): string {
  return `${SENTINEL}\n${JSON.stringify(model)}`;
}

/** Parse a `content` string into a canvas model, or null if it isn't a canvas. */
export function parseCanvas(content: string | null | undefined): CanvasModel | null {
  if (!isCanvasContent(content)) return null;
  try {
    const json = content!.trimStart().slice(SENTINEL.length).trim();
    const parsed = JSON.parse(json) as CanvasModel;
    if (!parsed || !Array.isArray(parsed.blocks)) return null;
    return { version: 1, blocks: parsed.blocks };
  } catch {
    return null;
  }
}

/** Derived elapsed ms for a running/paused timer or stopwatch, given "now". */
export function elapsedMs(block: { startedAt: number | null; baseElapsedMs: number }, nowMs: number): number {
  return block.baseElapsedMs + (block.startedAt != null ? Math.max(0, nowMs - block.startedAt) : 0);
}

/** Remaining ms for a countdown timer (never negative). */
export function remainingMs(block: TimerBlock, nowMs: number): number {
  return Math.max(0, block.durationMs - elapsedMs(block, nowMs));
}

/** Stable id generator that does not rely on Math.random for the prefix. */
let seq = 0;
export function newBlockId(): string {
  seq += 1;
  return `b${seq}_${Date.now().toString(36)}`;
}

export const STICKY_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#ddd6fe'];

/** Sensible default geometry + payload for a freshly-added block of `type`. */
export function defaultBlock(type: CanvasBlockType, at: { x: number; y: number }): CanvasBlock {
  const base = { id: newBlockId(), x: at.x, y: at.y };
  switch (type) {
    case 'text':
      return { ...base, type, w: 240, h: 120, text: '' };
    case 'sticky':
      return { ...base, type, w: 180, h: 160, text: '', color: STICKY_COLORS[0] };
    case 'image':
      return { ...base, type, w: 260, h: 180, url: '', alt: '' };
    case 'embed':
      return { ...base, type, w: 280, h: 160, documentId: '' };
    case 'timer':
      return { ...base, type, w: 200, h: 130, durationMs: 5 * 60 * 1000, startedAt: null, baseElapsedMs: 0 };
    case 'stopwatch':
      return { ...base, type, w: 200, h: 130, startedAt: null, baseElapsedMs: 0 };
  }
}
