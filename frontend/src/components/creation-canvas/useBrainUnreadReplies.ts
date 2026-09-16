/*
 * No `'use client'`. Imported by `CreationCanvas.tsx`, which already declares the
 * boundary — the same reasoning `useChromeSpace` states in its own header.
 */
import { useState } from 'react';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';

/**
 * HOW MANY REPLIES LANDED WHILE YOU WERE NOT LOOKING.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * On a phone the Brain dock is a SHEET, and rule two of this canvas is that Brain
 * never covers the surface uninvited. That is only honest if the reader can tell
 * something arrived — otherwise "you open it when you want it" means "you open it
 * every thirty seconds in case". The launcher pill above the composer therefore
 * carries a count, and this is the count.
 *
 * ── WHAT "UNREAD" MEANS HERE ─────────────────────────────────────────────────────
 * Assistant messages appended SINCE the conversation was last on screen. The mark is
 * taken while the surface is open and re-taken the moment it closes, so:
 *
 *   - with the sheet open, the count is always zero — you are reading it;
 *   - closing it zeroes the count, because you have just read everything in it;
 *   - a reply that streams in behind a closed sheet raises it by one.
 *
 * It counts ASSISTANT messages only. The reader's own line, a system notice and a
 * collaborator's turn are all things they either did or can see elsewhere; a pill
 * saying "1 reply from Brain" that turns out to be your own sentence is a pill that
 * gets ignored the second time.
 *
 * ── WHY IT IS COUNTED FROM A TOTAL AND NOT ACCUMULATED ───────────────────────────
 * The transcript is re-derived from the timeline on every change, and a turn can be
 * replaced in place (a streaming reply settling, a revision landing) rather than
 * appended. Incrementing on each render would drift; a high-water mark cannot. The
 * mark clamps DOWN as well as up, so a history restore that shortens the transcript
 * leaves the pill at zero rather than at a negative that renders as "-3 replies".
 *
 * ── WHY THE MARK IS ADJUSTED DURING RENDER AND NOT IN AN EFFECT ──────────────────
 * An effect would paint one frame with the OLD count after the sheet opens — the pill
 * saying "2 replies from Brain" over an open conversation containing them — and that
 * frame is the one somebody taps. Adjusting state during render is React's documented
 * answer for "state derived from props that must not lag", and it is what the canvas
 * composer does for the same reason.
 */
export function useBrainUnreadReplies(messages: readonly BrainMessage[], open: boolean): number {
  const replies = messages.reduce((total, message) => total + (message.role === 'assistant' ? 1 : 0), 0);
  const [seen, setSeen] = useState(replies);
  // Open: you are reading it, so everything on screen is seen and stays seen as it
  // arrives. Closed: the mark stands still and the difference is the count — except
  // downward, where a shortened transcript must not leave a mark in the future.
  const mark = open ? replies : Math.min(seen, replies);
  if (seen !== mark) setSeen(mark);

  return open ? 0 : Math.max(0, replies - mark);
}
