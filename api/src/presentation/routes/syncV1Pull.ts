/**
 * Presentation — /api/sync/v1/pull request handler (G18, ticket #5852).
 *
 * NOT registered. This file only owns the handler function; it does not mount
 * a route, does not read Postgres, and does not call fetch. The caller
 * supplies the change rows it has already loaded.
 *
 * The handler is a thin adapter: it delegates to `queryPull`
 * (application/sync/pullDelta) and returns that result UNCHANGED, including
 * `resnapshotRequired`. It does not reimplement or wrap the cursor codec, does
 * not synthesise a sequence-0 page, and never turns a resnapshot into a
 * partial page.
 */

import { queryPull } from '../../application/sync/pullDelta';
import type { QueryPullInput, QueryPullResult } from '../../application/sync/pullDelta';

export type SyncV1PullInput<T = unknown> = QueryPullInput<T>;
export type SyncV1PullResult<T = unknown> = QueryPullResult<T>;

/**
 * Handle one pull request.
 *
 * Returns `queryPull`'s result unchanged:
 *
 * - A usable delta cursor: the `{ changes, cursor }` delta page.
 * - Null, blank, undecodable, non-delta, or a delta seq older than
 *   `retainedThroughSeq`: the frozen `{ resnapshotRequired: true }` and
 *   nothing else.
 *
 * No database, no network, no route mount. The input object is not mutated.
 */
export function handleSyncV1Pull<T = unknown>(
  input: SyncV1PullInput<T> | null | undefined,
): SyncV1PullResult<T> {
  return queryPull<T>(input);
}