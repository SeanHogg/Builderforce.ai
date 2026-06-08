/**
 * Human-in-the-loop request kinds.
 *
 * The `approvals` table is the agent's single "bubble up to a human" channel.
 * Every row is one of three kinds, differing only in how a human resolves it:
 *
 *   - `approval` — a high-risk action that must be approved or rejected before
 *     the agent proceeds (the original use case).
 *   - `question` — the agent is blocked and needs a free-text answer to continue.
 *   - `feedback` — the agent wants a human to review work and comment.
 *
 * `question`/`feedback` resolve to status `answered` with the human's text in
 * `response_text`; `approval` resolves to `approved`/`rejected`.
 *
 * Kept in the domain layer (not a route) so the API, the gate contract, and any
 * future caller share one source of truth for the valid set + the default.
 */
export const REQUEST_KINDS = ['approval', 'question', 'feedback'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const DEFAULT_REQUEST_KIND: RequestKind = 'approval';

/** Coerce arbitrary input to a valid kind, falling back to 'approval'. */
export function normalizeRequestKind(value: unknown): RequestKind {
  return REQUEST_KINDS.includes(value as RequestKind) ? (value as RequestKind) : DEFAULT_REQUEST_KIND;
}

/** Kinds resolved by a free-text answer (status='answered') rather than approve/reject. */
export function isAnswerableKind(kind: RequestKind): boolean {
  return kind === 'question' || kind === 'feedback';
}
