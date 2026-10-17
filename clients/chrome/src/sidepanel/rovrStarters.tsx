/**
 * Rovr's fixed starting points — ONE list read twice: the empty chat's starter tiles
 * and, once a chat has begun, the composer's next-step chips. Each one seeds the box
 * with its prompt; the person edits and sends it. Never a model call.
 */
import type { ReactNode } from 'react';
import type { MessageKey } from '../i18n/t';

export interface RovrStarter {
  id: string;
  /** The tile / chip label. */
  label: MessageKey;
  /** What it puts in the box — also the tile's one-line hint. */
  prompt: MessageKey;
  icon: ReactNode;
}

function Glyph({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const ROVR_STARTERS: readonly RovrStarter[] = [
  { id: 'summarize', label: 'suggestSummarize', prompt: 'suggestSummarizePrompt', icon: <Glyph d="M4 6h16M4 12h10M4 18h7" /> },
  { id: 'fill', label: 'suggestFill', prompt: 'suggestFillPrompt', icon: <Glyph d="M4 5h16v14H4zM8 10h8M8 14h5" /> },
  { id: 'task', label: 'suggestTask', prompt: 'suggestTaskPrompt', icon: <Glyph d="M9 11l3 3 8-8M20 12v7H4V5h11" /> },
];
