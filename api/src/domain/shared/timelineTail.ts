/**
 * The TAIL of an append-only timeline — the NEWEST `limit` rows, oldest-first.
 *
 * `ORDER BY seq LIMIT 100` reads like "the transcript, capped". It is in fact
 * "the first hundred rows this chat ever had". The distinction is invisible on a
 * short chat and total on a long one, because every tool step is persisted as a
 * message row: a working chat crosses a hundred rows in a handful of turns, and
 * from then on the endpoint serves the opening of the conversation and nothing
 * else. The symptom reported was "leave a chat, come back, the model's last
 * reply is gone" — the reply was never missing from the database, it was past
 * the window.
 *
 * A capped read of an append-only log almost always wants the END of it, so the
 * clamp and the re-reversal live here rather than being re-derived per query.
 * The caller supplies the query because ordering is the storage layer's business
 * and this module is domain code: pure, dependency-free, no drizzle, no `Database`
 * type, so neither presentation nor infrastructure has to import the other to
 * read a window. Its ONE contract is stated in {@link readTimelineTail}.
 */
import { limitParam } from './boundedInt';

/**
 * Read the newest `limit` rows of a timeline and hand them back in reading order.
 *
 * `take` MUST order DESCENDING by the timeline's sequence column — that is the
 * whole point, and the reason this is a function rather than a comment. It
 * receives the clamped row count and returns newest-first; this reverses the
 * result so callers get the usual oldest-first transcript.
 *
 * @param take  Runs the descending, limited query. Ordering is the caller's.
 * @param limit Requested rows. Junk or absent falls back to `max`.
 * @param max   Hard ceiling, so an untrusted `?limit=` cannot read the table.
 */
export async function readTimelineTail<T>(
  take: (rows: number) => Promise<T[]>,
  limit: number,
  max: number,
): Promise<T[]> {
  const newestFirst = await take(limitParam(limit, max, max));
  return newestFirst.reverse();
}
