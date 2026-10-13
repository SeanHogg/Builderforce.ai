// No `'use client'`: this module exports a store and hooks, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { VisualSelection } from '@/lib/visualEditor';
import type { WorkspaceId } from './workspaceId';

/**
 * THE ELEMENTS SOMEONE POINTED AT — and the one way they reach a Brain.
 *
 * "Select to edit" used to open its own two-field form under the preview (copy, classes)
 * that rewrote one source line without the Brain. That was a second place to ask for a
 * change, with a second vocabulary, beside the prompt every other request goes through.
 * Now a pick is CONTEXT for the ONE prompt: the composer shows each pick as a removable
 * chip, and the next request the person sends is told exactly which elements it means —
 * so "make this bigger" is answered by the same Brain, in the same transcript, as
 * everything else.
 *
 * A pick has one of two anchors:
 *   • `source`   — an element clicked in a live preview, anchored where React rendered
 *                  it (file and line);
 *   • `selector` — an element of a captured page, anchored by its rect-map CSS selector
 *                  and label (Insights "Apply in composer", PRD 33 §5.2) — no source
 *                  location exists for it, so the model is told the page and selector.
 *
 * The store holds every pick in the window, grouped by OWNER (a preview's workspace id,
 * or a host surface such as Insights). An owner replaces its own picks as a set — a
 * preview's new click replaces its previous one; a new "Apply in composer" replaces the
 * previous fix's elements — and withdraws them when it unmounts, so a chip never outlives
 * the thing it points into. Other owners' picks are untouched.
 */
export type PreviewPickAnchor =
  | ({ kind: 'source' } & VisualSelection)
  | { kind: 'selector'; selector: string; label: string; pagePath: string };

/** Who made a pick: a preview's workspace, or a host surface (`surface:<name>`). */
export type PreviewPickOwner = WorkspaceId | `surface:${string}`;

export interface PreviewPick {
  owner: PreviewPickOwner;
  /** The app's name — which app, on a board that holds more than one; null when not known. */
  appName: string | null;
  anchor: PreviewPickAnchor;
}

const NONE: readonly PreviewPick[] = Object.freeze([]);

let current: readonly PreviewPick[] = NONE;
const listeners = new Set<() => void>();

function publish(next: readonly PreviewPick[]): void {
  const settled = next.length === 0 ? NONE : next;
  if (settled === current) return;
  current = settled;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): readonly PreviewPick[] {
  return current;
}

function serverSnapshot(): readonly PreviewPick[] {
  return NONE;
}

/** What makes two picks the same element (dedupe, React keys). */
export function previewPickKey(pick: PreviewPick): string {
  const a = pick.anchor;
  return a.kind === 'source'
    ? `${String(pick.owner)}|source|${a.file}:${a.line}:${a.column}`
    : `${String(pick.owner)}|selector|${a.pagePath}|${a.selector}`;
}

/** Replace `owner`'s picks with `picks` (duplicates dropped); every other owner's stay. */
export function setPreviewPicks(owner: PreviewPickOwner, picks: readonly PreviewPick[]): void {
  const seen = new Set<string>();
  const mine = picks.filter((pick) => {
    const key = previewPickKey(pick);
    if (pick.owner !== owner || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const others = current.filter((pick) => pick.owner !== owner);
  if (mine.length === 0 && others.length === current.length) return;
  publish([...others, ...mine]);
}

/** Point the composer at one element: it replaces its owner's earlier pick(s). */
export function setPreviewPick(pick: PreviewPick): void {
  setPreviewPicks(pick.owner, [pick]);
}

/** Withdraw one pick (a chip's ×, or a turn spending what it carried). Matched by identity. */
export function removePreviewPick(pick: PreviewPick): void {
  if (!current.includes(pick)) return;
  publish(current.filter((p) => p !== pick));
}

/** Withdraw every pick, or only one owner's (a preview unmounting passes its own). */
export function clearPreviewPicks(only?: { owner: PreviewPickOwner }): void {
  if (current.length === 0) return;
  publish(only ? current.filter((pick) => pick.owner !== only.owner) : NONE);
}

/** The picks as they stand, outside React — a turn reads them at the moment it is sent. */
export function getPreviewPicks(): readonly PreviewPick[] {
  return current;
}

/** Read the picks and withdraw them: the turn being sent is the one they were for. */
export function takePreviewPicks(): readonly PreviewPick[] {
  const picks = current;
  publish(NONE);
  return picks;
}

/** The picks, live. */
export function usePreviewPicks(): readonly PreviewPick[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Run `reveal` whenever a NEW pick arrives — for a host whose prompt can be out of view
 * (closed on the canvas, collapsed or on the other pane in the Studio workspace): a pick
 * whose chip lands in a hidden prompt is a click that seemed to do nothing.
 */
export function useOnPreviewPick(reveal: () => void): void {
  const picks = usePreviewPicks();
  const revealRef = useRef(reveal);
  const previous = useRef<readonly PreviewPick[]>(NONE);
  useEffect(() => { revealRef.current = reveal; }, [reveal]);
  useEffect(() => {
    const before = previous.current;
    previous.current = picks;
    if (picks.some((pick) => !before.includes(pick))) revealRef.current();
  }, [picks]);
}

/**
 * For a composer whose context is read reactively (the workspace Brain's `extraSystem`):
 * the picks standing when a turn STARTS are the ones that turn carried, so they are
 * withdrawn when that turn settles — any pick made meanwhile stays for the next one.
 */
export function useSpendPreviewPicksOnSettle(sending: boolean): void {
  const carried = useRef<readonly PreviewPick[]>(NONE);
  const wasSending = useRef(false);
  useEffect(() => {
    if (sending && !wasSending.current) carried.current = current;
    if (!sending && wasSending.current && carried.current.length > 0) {
      const spent = carried.current;
      publish(current.filter((pick) => !spent.includes(pick)));
      carried.current = NONE;
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
 * What the model is told about one pick. Model-facing, not UI copy: it rides in the
 * turn's system context, never in the transcript. A source pick names the anchor React
 * reported — file and line — so the edit starts at the right place; a selector pick names
 * the element by label and selector on its page, which is all a captured page knows.
 */
export function previewPickContext(pick: PreviewPick): string {
  const a = pick.anchor;
  const app = pick.appName ? ` of the app "${pick.appName}"` : '';
  if (a.kind === 'selector') {
    const label = previewPickExcerpt(a.label, 80);
    const element = label ? `element \`${label}\` (\`${a.selector}\`)` : `element \`${a.selector}\``;
    return [
      `The user attached an element of a page${app}: ${element} on \`${a.pagePath}\`.`,
      'Apply this request to that element: find the component that renders it on that page, and change nothing else unless the request asks for it.',
    ].join('\n');
  }
  const text = previewPickExcerpt(a.text, 200);
  const details = [
    text ? `its visible text is "${text}"` : null,
    a.className ? `its classes are "${a.className}"` : null,
  ].filter(Boolean).join(' and ');
  return [
    `The user picked an element in the live preview${app}: a <${a.tag}> rendered from \`${a.file}\` at line ${a.line}${details ? `; ${details}` : ''}.`,
    `Apply this request to that element: edit \`${a.file}\` around line ${a.line} in that app's files, and change nothing else unless the request asks for it.`,
  ].join('\n');
}

/** Every pick's note, one paragraph each; '' when nothing is picked. */
export function previewPicksContext(picks: readonly PreviewPick[]): string {
  return picks.map(previewPickContext).join('\n\n');
}
