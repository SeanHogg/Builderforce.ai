/**
 * conductRotation — a durable ROTATION CURSOR for the PR-conduct sweep's capped reads.
 *
 * ── WHY ORDER-BY-UPDATED-AT WAS NOT ENOUGH ───────────────────────────────────────────
 * Both of the sweep's reads (projects per tick, review tickets per project) are capped, and
 * were ordered by `tasks.updated_at asc`. That is fair only if conducting a ticket TOUCHES
 * it — and the common outcomes do not: `wait_for_run`, `wait_for_build`, `await_merge` and a
 * held `drive_signoff` / return all leave `updated_at` alone. The twenty oldest tickets
 * therefore sat at the head of the window forever and ticket 21 was never conducted.
 *
 * The cursor is the id of the last unit the previous tick EXAMINED; the next tick starts
 * after it and wraps around, so every unit is reached within ceil(total / cap) ticks
 * whatever the outcomes were. It lives in KV scratch (`runtime/kvScratch.ts`, the same
 * best-effort store `manager/passRotation.ts` uses): it is a hint, and losing it costs one
 * tick that starts from the beginning.
 */
import { peekScratch, saveScratch } from '../runtime/kvScratch';
import type { Env } from '../../env';

const CURSOR_TTL_SECONDS = 86_400;

export const conductTicketCursorKey = (tenantId: number, projectId: number): string =>
  `pr-conduct:tickets:${tenantId}:${projectId}`;
export const CONDUCT_PROJECT_CURSOR_KEY = 'pr-conduct:projects';

/** The last id examined, or 0 (start from the beginning) when there is none. */
export async function loadRotationCursor(env: Env, key: string): Promise<number> {
  const v = await peekScratch<number>(env, key);
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export async function saveRotationCursor(env: Env, key: string, lastExaminedId: number): Promise<void> {
  await saveScratch(env, key, lastExaminedId, CURSOR_TTL_SECONDS);
}

/** How the caller reads one segment of the id-ordered set. */
export type RotationFetch<T> = (range: { after: number } | { upTo: number }, limit: number) => Promise<T[]>;

/**
 * Up to `limit` units: everything with id > cursor first (ascending), then — only if the
 * window is not full — wrapping to the lowest ids up to and including the cursor.
 */
export async function takeRotatingWindow<T>(args: {
  cursor: number; limit: number; fetch: RotationFetch<T>;
}): Promise<T[]> {
  const head = await args.fetch({ after: args.cursor }, args.limit);
  if (head.length >= args.limit || args.cursor <= 0) return head;
  const wrapped = await args.fetch({ upTo: args.cursor }, args.limit - head.length);
  return [...head, ...wrapped];
}
