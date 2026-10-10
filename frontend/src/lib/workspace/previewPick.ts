// No `'use client'`: this module exports a store and a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { VisualSelection } from '@/lib/visualEditor';
import type { WorkspaceId } from './workspaceId';

/**
 * THE ELEMENT SOMEONE POINTED AT IN A LIVE PREVIEW — and the one way it reaches a Brain.
 *
 * "Select to edit" used to open its own two-field form under the preview (copy, classes)
 * that rewrote one source line without the Brain. That was a second place to ask for a
 * change, with a second vocabulary, beside the prompt every other request goes through.
 * Now a pick is CONTEXT for the ONE prompt: the composer shows it as a removable chip,
 * and the next request the person sends is told exactly which element, in which file, on
 * which line it means — so "make this bigger" is answered by the same Brain, in the same
 * transcript, as everything else.
 *
 * One pick per window, because there is one composer per screen. The preview that made a
 * pick withdraws it when it unmounts (`clearPreviewPick` with its own workspace id), so a
 * chip never outlives the preview it points into.
 */
export interface PreviewPick extends VisualSelection {
  /** The workspace whose preview the element was picked in. */
  workspaceId: WorkspaceId;
  /** The app's name — which app, on a board that holds more than one. */
  appName: string;
}

let current: PreviewPick | null = null;
const listeners = new Set<() => void>();

function publish(next: PreviewPick | null): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): PreviewPick | null {
  return current;
}

function serverSnapshot(): PreviewPick | null {
  return null;
}

/** Point the composer at an element. Replaces any earlier pick. */
export function setPreviewPick(pick: PreviewPick): void {
  publish(pick);
}

/**
 * Withdraw the pick — any pick, or only one the caller made: a preview unmounting passes
 * its workspace, and a turn that used a pick passes that pick, so neither wipes a newer
 * pick made in the meantime.
 */
export function clearPreviewPick(only?: { workspaceId: WorkspaceId } | PreviewPick): void {
  if (!current) return;
  if (only) {
    // A pick is matched by identity; a workspace by id.
    const matches = 'file' in only ? current === only : current.workspaceId === only.workspaceId;
    if (!matches) return;
  }
  publish(null);
}

/** The pick as it stands, outside React — a turn reads it at the moment it is sent. */
export function getPreviewPick(): PreviewPick | null {
  return current;
}

/** Read the pick and withdraw it: the turn being sent is the one it was for. */
export function takePreviewPick(): PreviewPick | null {
  const pick = current;
  publish(null);
  return pick;
}

/** The pick, live. */
export function usePreviewPick(): PreviewPick | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Run `reveal` whenever a NEW pick arrives — for a host whose prompt can be out of view
 * (closed on the canvas, collapsed or on the other pane in the Studio workspace): a pick
 * whose chip lands in a hidden prompt is a click that seemed to do nothing.
 */
export function useOnPreviewPick(reveal: () => void): void {
  const pick = usePreviewPick();
  const revealRef = useRef(reveal);
  useEffect(() => { revealRef.current = reveal; }, [reveal]);
  useEffect(() => {
    if (pick) revealRef.current();
  }, [pick]);
}

/**
 * For a composer whose context is read reactively (the workspace Brain's `extraSystem`):
 * the pick standing when a turn STARTS is the one that turn carried, so it is withdrawn
 * when that turn settles — unless the person has picked something else meanwhile.
 */
export function useSpendPreviewPickOnSettle(sending: boolean): void {
  const carried = useRef<PreviewPick | null>(null);
  const wasSending = useRef(false);
  useEffect(() => {
    if (sending && !wasSending.current) carried.current = current;
    if (!sending && wasSending.current && carried.current) {
      clearPreviewPick(carried.current);
      carried.current = null;
    }
    wasSending.current = sending;
  }, [sending]);
}

/** Visible text short enough for a chip or a system note. */
export function previewPickExcerpt(text: string | null, max = 60): string | null {
  const trimmed = text?.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * What the model is told about the pick. Model-facing, not UI copy: it rides in the
 * turn's system context, never in the transcript. It names the anchor React reported —
 * file and line — so the edit starts at the right place instead of a search for it.
 */
export function previewPickContext(pick: PreviewPick): string {
  const text = previewPickExcerpt(pick.text, 200);
  const details = [
    text ? `its visible text is "${text}"` : null,
    pick.className ? `its classes are "${pick.className}"` : null,
  ].filter(Boolean).join(' and ');
  return [
    `The user picked an element in the live preview of the app "${pick.appName}": a <${pick.tag}> rendered from \`${pick.file}\` at line ${pick.line}${details ? `; ${details}` : ''}.`,
    `Apply this request to that element: edit \`${pick.file}\` around line ${pick.line} in that app's files, and change nothing else unless the request asks for it.`,
  ].join('\n');
}
