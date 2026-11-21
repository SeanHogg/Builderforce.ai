/**
 * MK-09-W6 — whether an opened pull request merges cleanly against its base.
 * Recorded on the execution payload (`prMergeability`) when finalize opens or adopts a PR.
 */
export interface PrMergeabilityRecord {
  mergeable: boolean | null;
  mergeableState: string | null;
  /** True only when the provider says the head merges against the base. Unknown is not clean. */
  mergesCleanly: boolean;
}

const CONFLICTED = new Set(['dirty', 'conflicted', 'conflicting']);

export function mergeabilityRecord(detail: {
  mergeable: boolean | null;
  mergeableState: string | null;
}): PrMergeabilityRecord {
  const state = detail.mergeableState;
  const mergesCleanly = detail.mergeable === true && !(state != null && CONFLICTED.has(state));
  return { mergeable: detail.mergeable, mergeableState: state, mergesCleanly };
}

export function withPrMergeability(payload: string | null | undefined, record: PrMergeabilityRecord): string {
  let obj: Record<string, unknown> = {};
  if (payload) {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
    } catch { /* a non-JSON payload is replaced by the stamp */ }
  }
  obj.prMergeability = record;
  return JSON.stringify(obj);
}

export function parsePrMergeability(payload: string | null | undefined): PrMergeabilityRecord | null {
  if (!payload) return null;
  try {
    const raw = (JSON.parse(payload) as { prMergeability?: PrMergeabilityRecord }).prMergeability;
    if (!raw || typeof raw !== 'object') return null;
    return mergeabilityRecord({
      mergeable: typeof raw.mergeable === 'boolean' ? raw.mergeable : null,
      mergeableState: typeof raw.mergeableState === 'string' ? raw.mergeableState : null,
    });
  } catch {
    return null;
  }
}
