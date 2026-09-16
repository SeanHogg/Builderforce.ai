/**
 * Union of a transcript and messages that may already be in it — the ONE merge
 * used both when a run splices its freshly-persisted turns into a mounted view
 * and when a chat re-reads its history from the server.
 *
 * The load path used to REPLACE: `getMessages(chatId).then(setMessages)`. That
 * is correct only if the server response is a superset of what the view already
 * holds, and it is not. A run persists its reply and hands it to mounted views
 * through the run store's `appended` buffer; a chat switch fires the fetch, the
 * fetch resolves last, and any appended turn the response did not carry is
 * dropped. The splice effect cannot put it back, because it is keyed on
 * `messagesEpoch` and no new turn has happened — so the model's last reply stays
 * missing until something else forces a reload. Merging instead of replacing is
 * what makes the two paths commute, in either order.
 *
 * Ordered by `seq`, the server's own append order, so a spliced-in turn lands
 * where it belongs rather than after whatever was fetched. Ties keep `base`
 * first: an id present in both is the same row, and the fetched copy is the
 * authoritative one.
 */
import type { BrainMessage } from './types';

export function mergeTranscript(
  base: readonly BrainMessage[],
  extra: readonly BrainMessage[],
): BrainMessage[] {
  if (extra.length === 0) return base as BrainMessage[];
  const have = new Set(base.map((m) => m.id));
  const fresh = extra.filter((m) => !have.has(m.id));
  if (fresh.length === 0) return base as BrainMessage[];
  return [...base, ...fresh].sort((a, b) => a.seq - b.seq);
}
