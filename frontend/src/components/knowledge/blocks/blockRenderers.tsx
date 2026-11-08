import type { ComponentType } from 'react';
import type { useTranslations } from 'next-intl';
import type { BlockType, DocumentBlock } from '@/domains/collab/domain/blockDocument';
import type { CanvasStroke } from '@/lib/canvasDrawing';
import { DrawingBlock } from './DrawingBlock';
import { MediaBlockCard } from './MediaBlockCard';

export interface BlockStrokeOps {
  append: (strokes: readonly CanvasStroke[]) => void;
  remove: (strokeIds: string[]) => void;
  update: (strokeId: string, patch: Partial<CanvasStroke>) => void;
  clear: () => void;
}

/** What every non-text block renderer receives. */
export interface BlockRendererProps {
  block: DocumentBlock;
  t: ReturnType<typeof useTranslations>;
  readOnly?: boolean;
  onFocus: () => void;
  /** Drawing-block stroke operations, already bound to this block. */
  strokeOps: BlockStrokeOps;
  /** Replace the block's asset with an uploaded file (media blocks). */
  onReplace: (file: File) => void;
}

/**
 * Block type → renderer. DATA, not a branch: a new block type is one entry here,
 * and the `Record` over every non-text type makes a missing entry a type error.
 * Text is the editor's own textarea and is deliberately absent.
 */
export const BLOCK_RENDERERS: Record<Exclude<BlockType, 'text'>, ComponentType<BlockRendererProps>> = {
  image: MediaBlockCard,
  video: MediaBlockCard,
  file: MediaBlockCard,
  drawing: DrawingBlock,
};
