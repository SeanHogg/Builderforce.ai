/**
 * THE URL OF A BOARD OPENED AT A THING — one builder, because `focus` is now
 * OPTIONAL and every hand-rolled copy got that wrong the same way.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Seven call sites wrote `` `/create/${sessionId}?focus=${objectId}` `` by hand.
 * That was harmless while every `…/open` route guaranteed an object card, and it
 * stopped being harmless the moment `POST /projects/:projectId/open` learned to
 * answer with the board that BECAME a project: conversion writes an identity
 * link and no card, so `objectId` is legitimately null and the template literal
 * produced `?focus=null` — a focus request for an object that does not exist,
 * on the one navigation a person makes right after converting their canvas.
 *
 * So the rule "omit focus when there is nothing to focus" is written once, and
 * the same builder carries the extra flags (`build=1`, a forwarded prompt) the
 * redirect surfaces already needed, instead of each one assembling a query
 * string its neighbour assembles slightly differently.
 */

/** What every `…/open` route answers with, narrowed to what a URL needs. */
export interface OpenedBoard {
  sessionId: string;
  /** The object to focus. Null/absent for a board with no card for the resource. */
  objectId?: string | null;
}

/**
 * The canvas URL for an opened board.
 *
 * `extra` entries with an empty, null or undefined value are dropped rather than
 * written as blanks — the callers forwarding `prompt`, `chat` and `ticket`
 * through a redirect all had to check that themselves before.
 */
export function openedBoardHref(
  opened: OpenedBoard,
  extra?: Readonly<Record<string, string | null | undefined>>,
): string {
  const query = new URLSearchParams();
  if (opened.objectId) query.set('focus', opened.objectId);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return `/create/${encodeURIComponent(opened.sessionId)}${search ? `?${search}` : ''}`;
}
