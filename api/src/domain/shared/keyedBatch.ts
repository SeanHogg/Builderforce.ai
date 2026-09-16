/**
 * Re-uniting a partly-deduplicated batch with the rows it did not write.
 *
 * An idempotent insert (`ON CONFLICT DO NOTHING`) returns nothing for the row it
 * skipped. That is the correct database behaviour and the wrong ANSWER: a caller
 * retrying a write it could not confirm gets back fewer rows than it sent, reads
 * the gap as a failure, and is back to losing the content it was trying to save —
 * the exact outcome idempotency was added to prevent. A retry has to be
 * indistinguishable from a first attempt, which means answering with the ORIGINAL
 * rows for the keys that were already there.
 *
 * Pure and dependency-free: the caller fetches, this decides. Keeping the ordering
 * rule out of the query lets it be asserted directly, which matters because the
 * rule is subtle — request order must survive a batch that mixes keyed rows (some
 * written now, some written by an earlier attempt) with keyless ones that are
 * always inserted.
 */

/** A row addressed by its producer key; `null` for rows written without one. */
export interface KeyedRow {
  eventKey: string | null;
}

/**
 * Rebuild the caller's batch in REQUEST ORDER from what was written now plus what
 * already existed.
 *
 * Keyed entries resolve by key, from `written` first and then `existing`. Keyless
 * entries are consumed in order from the keyless remainder of `written`, since
 * nothing else can identify them. An entry that resolves to neither is dropped:
 * it was not written and does not exist, so there is no row to report.
 */
export function reconcileKeyedBatch<T extends KeyedRow>(
  requested: ReadonlyArray<{ eventKey?: string | null }>,
  written: ReadonlyArray<T>,
  existing: ReadonlyArray<T> = [],
): Array<Omit<T, 'eventKey'>> {
  const byKey = new Map<string, T>();
  const keyless: T[] = [];
  for (const row of written) {
    if (row.eventKey) byKey.set(row.eventKey, row);
    else keyless.push(row);
  }
  // Rows written NOW win over rows read back, though for a given key they are the
  // same row — the insert and the select cannot both have produced it.
  for (const row of existing) {
    if (row.eventKey && !byKey.has(row.eventKey)) byKey.set(row.eventKey, row);
  }

  const out: Array<Omit<T, 'eventKey'>> = [];
  let next = 0;
  for (const req of requested) {
    const hit = req.eventKey ? byKey.get(req.eventKey) : keyless[next++];
    if (!hit) continue;
    const { eventKey: _key, ...row } = hit;
    out.push(row);
  }
  return out;
}

/** The keys in `requested` that `written` did not account for — what to go and fetch. */
export function unwrittenKeys(
  requested: ReadonlyArray<{ eventKey?: string | null }>,
  written: ReadonlyArray<KeyedRow>,
): string[] {
  const have = new Set(written.map((r) => r.eventKey).filter((k): k is string => !!k));
  const missing = new Set<string>();
  for (const req of requested) {
    if (req.eventKey && !have.has(req.eventKey)) missing.add(req.eventKey);
  }
  return [...missing];
}
