/**
 * Board-sync reconciler — PURE decision logic (NO IO).
 *
 * Decides what to do when an external ticket is observed during a sync poll or
 * webhook ingest, given the currently-stored link row (or null for first sight).
 *
 * Idempotency key is (connectionId, externalId): callers must already have
 * loaded the existing link for that pair. This module never touches the DB.
 *
 * Core rules:
 *  - First sight (existing == null)               → 'applied' (create the link).
 *  - Version regression / replay
 *    (incoming.externalVersion <= stored AND
 *     contentHash unchanged)                       → 'skipped_idempotent'.
 *  - Echo suppression: an inbound event that merely reflects a change we just
 *    pushed out (stored syncState == 'dirty_remote' and the content now matches
 *    what we sent) is acknowledged but not re-applied                → 'skipped_idempotent'.
 *  - Conflict: both sides dirty — the local copy has unpushed edits
 *    (syncState 'dirty_local') AND the remote content changed too     → 'conflict'.
 *  - Otherwise the remote moved forward                              → 'applied'.
 *
 * Version comparison is by the provider's own monotonic version token
 * (externalVersion), NEVER by wall-clock timestamp, so clock skew between the
 * provider and us cannot cause double-apply or mis-ordering.
 */

/** Sync state stored on an external_ticket_links row. */
export type SyncState = 'synced' | 'dirty_local' | 'dirty_remote' | 'conflict';

/** The subset of a stored external_ticket_links row the reconciler reasons about. */
export interface ExistingLink {
  externalId:      string;
  externalVersion: string | null;
  contentHash:     string | null;
  syncState:       SyncState;
  /** Normalized fields last applied locally (opaque to the reconciler). */
  fields?:         Record<string, unknown> | null;
}

/** A normalized ticket observed from the provider. */
export interface IncomingTicket {
  externalId:      string;
  externalVersion: string | null;
  contentHash:     string | null;
  fields:          Record<string, unknown>;
  /**
   * True when this inbound event is the echo of a write we originated (e.g. the
   * provider replays our own outbound update through the webhook). Callers may
   * set this from a provider actor/author check.
   */
  originatedLocally?: boolean;
}

export type ReconcileDecision = 'applied' | 'skipped_idempotent' | 'conflict';

export interface ReconcileResult {
  decision: ReconcileDecision;
  /** Reason tag for logging / observability. */
  reason: string;
  /** The link fields to persist when decision === 'applied' or 'conflict'. */
  merged: {
    externalId:      string;
    externalVersion: string | null;
    contentHash:     string | null;
    syncState:       SyncState;
    fields:          Record<string, unknown>;
  };
}

/**
 * Compare two provider version tokens.
 * Returns >0 when a is newer, <0 when older, 0 when equal/indeterminate.
 *
 * Tokens may be numeric (Jira version#, issue updated epoch) or opaque strings
 * (GitHub ETag, ISO updated_at). Numeric strings compare numerically; otherwise
 * we fall back to a lexicographic compare which is stable & monotonic for ISO-8601
 * timestamps and ETags. Equal strings are treated as "same version".
 */
export function compareVersion(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a === b) return 0;

  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (na > nb) return 1;
    if (na < nb) return -1;
    return 0;
  }

  // Lexicographic fallback (ISO timestamps / ETags sort correctly here).
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

/**
 * Reconcile an incoming ticket against the stored link.
 * Pure: same inputs always yield the same result.
 */
export function reconcile(existing: ExistingLink | null, incoming: IncomingTicket): ReconcileResult {
  // First time we see this (connectionId, externalId): always apply.
  if (existing == null) {
    return {
      decision: 'applied',
      reason: 'first_sight',
      merged: {
        externalId:      incoming.externalId,
        externalVersion: incoming.externalVersion,
        contentHash:     incoming.contentHash,
        syncState:       'synced',
        fields:          incoming.fields,
      },
    };
  }

  const cmp = compareVersion(incoming.externalVersion, existing.externalVersion);
  const contentUnchanged = incoming.contentHash != null && incoming.contentHash === existing.contentHash;
  const contentChanged = !contentUnchanged;

  // Echo suppression: an inbound event reflecting our own just-pushed write.
  // We were awaiting the remote to acknowledge our outbound edit (dirty_remote).
  // If the event is flagged as locally-originated, OR the content now exactly
  // matches what we sent, acknowledge by clearing dirty state without re-apply.
  if (existing.syncState === 'dirty_remote') {
    if (incoming.originatedLocally || contentUnchanged) {
      return {
        decision: 'skipped_idempotent',
        reason: 'echo_suppressed',
        merged: {
          externalId:      existing.externalId,
          externalVersion: incoming.externalVersion ?? existing.externalVersion,
          contentHash:     incoming.contentHash ?? existing.contentHash,
          syncState:       'synced',
          fields:          (existing.fields ?? {}) as Record<string, unknown>,
        },
      };
    }
  }

  // Explicit echo flag (even when not in dirty_remote): never re-apply our own write.
  if (incoming.originatedLocally && contentUnchanged) {
    return {
      decision: 'skipped_idempotent',
      reason: 'echo_suppressed',
      merged: {
        externalId:      existing.externalId,
        externalVersion: incoming.externalVersion ?? existing.externalVersion,
        contentHash:     existing.contentHash,
        syncState:       existing.syncState === 'dirty_remote' ? 'synced' : existing.syncState,
        fields:          (existing.fields ?? {}) as Record<string, unknown>,
      },
    };
  }

  // Idempotent replay / version regression: stale or equal version AND content
  // identical → nothing to do. Dedupe is by version token, NOT timestamp, so a
  // skewed provider clock cannot fool us into re-applying.
  if (cmp <= 0 && contentUnchanged) {
    return {
      decision: 'skipped_idempotent',
      reason: cmp < 0 ? 'version_regression' : 'duplicate_version',
      merged: {
        externalId:      existing.externalId,
        externalVersion: existing.externalVersion,
        contentHash:     existing.contentHash,
        syncState:       existing.syncState,
        fields:          (existing.fields ?? {}) as Record<string, unknown>,
      },
    };
  }

  // A strictly older version whose content differs is still a stale event: a
  // late/duplicate delivery of a superseded revision. Skip — do not regress.
  if (cmp < 0) {
    return {
      decision: 'skipped_idempotent',
      reason: 'version_regression',
      merged: {
        externalId:      existing.externalId,
        externalVersion: existing.externalVersion,
        contentHash:     existing.contentHash,
        syncState:       existing.syncState,
        fields:          (existing.fields ?? {}) as Record<string, unknown>,
      },
    };
  }

  // Conflict: we have un-pushed local edits AND the remote content moved.
  if (existing.syncState === 'dirty_local' && contentChanged) {
    return {
      decision: 'conflict',
      reason: 'concurrent_local_and_remote_edit',
      merged: {
        externalId:      existing.externalId,
        externalVersion: incoming.externalVersion,
        contentHash:     incoming.contentHash,
        syncState:       'conflict',
        fields:          incoming.fields,
      },
    };
  }

  // Remote advanced (newer version with changed content) and we have no local
  // divergence: apply the incoming snapshot.
  return {
    decision: 'applied',
    reason: 'remote_advanced',
    merged: {
      externalId:      incoming.externalId,
      externalVersion: incoming.externalVersion,
      contentHash:     incoming.contentHash,
      syncState:       'synced',
      fields:          incoming.fields,
    },
  };
}

/**
 * Stable content hash over a normalized field set (order-independent).
 * Pure & deterministic — used by providers/engine to populate contentHash.
 */
export function hashFields(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).sort();
  const canonical = keys.map((k) => `${k}=${stableStringify(fields[k])}`).join('');
  return fnv1a32Hex(canonical);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${k}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** FNV-1a 32-bit hash → 8-char hex. Deterministic, no crypto/IO. */
function fnv1a32Hex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 to get unsigned, then pad to 8 hex chars.
  return (h >>> 0).toString(16).padStart(8, '0');
}
