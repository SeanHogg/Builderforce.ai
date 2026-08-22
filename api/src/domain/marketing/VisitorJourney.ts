/**
 * What an anonymous visitor DID — the journey, as domain values.
 *
 * `GuestPrompt` is the sibling of this file: it owns what a visitor ASKED FOR.
 * Together they are the whole anonymous record, and they are deliberately two
 * modules because they answer two different questions and are written by
 * different call sites.
 *
 * Everything here is pure. The vocabulary has to be identical whether an event
 * arrives from the site-wide tracker, the persona demo, or the error reporter,
 * so the three can never disagree about what a `page_view` is.
 */

/**
 * The journey kinds the flow graph understands.
 *
 * This is not the whole vocabulary — `kind` stays open (see {@link isVisitorEventKind})
 * because a surface that wants to record something specific should not need a
 * migration to do it, and an unrecognised kind is still worth keeping on the
 * timeline. These are the ones with STRUCTURAL meaning: the graph starts at a
 * visit, walks page views, marks errors, and ends where the visitor went.
 */
export const VISITOR_JOURNEY_KINDS = {
  /** A contiguous run of activity begins. `metadata.returning` distinguishes a
   *  first visit from a comeback, which the graph draws as a different entry. */
  visitStart: 'visit_start',
  /** A navigation. `path` is the destination — the edge is derived from the
   *  PREVIOUS page view in the same visit, never stored, so a re-order of the
   *  stream cannot produce an edge that never happened. */
  pageView: 'page_view',
  /** Something broke in front of them. The single most important thing that was
   *  missing from this stream: an anonymous visitor's error was reported to
   *  Product Quality with no visitor id on it, so "which errors cost us
   *  signups" was unanswerable by construction. */
  error: 'error',
  /** The visit ended. `metadata.durationMs` and `metadata.reason` say how. */
  visitEnd: 'visit_end',
} as const;

export type VisitorJourneyKind = (typeof VISITOR_JOURNEY_KINDS)[keyof typeof VISITOR_JOURNEY_KINDS];

/** A journey event that has been validated and is safe to persist. */
export interface VisitorEvent {
  visitorId: string;
  visitId: string | null;
  persona: string | null;
  kind: string;
  path: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: Date;
}

/** Abuse ceilings for an UNAUTHENTICATED append-only write. Not product limits:
 *  a real visit records tens of events, not hundreds. */
export const VISITOR_EVENT_LIMITS = {
  /** Events accepted in one POST. The client batches and flushes on page hide. */
  maxPerBatch: 40,
  /** How far an event's client clock may be from ours before we stamp it
   *  ourselves. A wrong clock must not be able to write into last week. */
  maxClockSkewMs: 86_400_000,
  maxPathChars: 300,
  maxMetadataChars: 2_000,
} as const;

const KIND_RE = /^[a-z][a-z0-9_]{1,63}$/;
const VISIT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Is this a storable kind? Open by design — see the note on VISITOR_JOURNEY_KINDS. */
export function isVisitorEventKind(value: unknown): value is string {
  return typeof value === 'string' && KIND_RE.test(value);
}

/** A visit token the client minted. Same alphabet as the visitor id. */
export function isVisitId(value: unknown): value is string {
  return typeof value === 'string' && VISIT_ID_RE.test(value);
}

/**
 * Normalise one raw event into a storable one, or reject it.
 *
 * Returns null rather than throwing: a batch arrives from an unauthenticated
 * browser on the unload path, and one malformed entry must cost that entry, not
 * the nineteen good ones next to it.
 */
export function parseVisitorEvent(
  input: {
    kind?: unknown;
    visitId?: unknown;
    persona?: unknown;
    path?: unknown;
    metadata?: unknown;
    occurredAt?: unknown;
  },
  context: { visitorId: string; personaOf: (value: unknown) => string | null; nowMs: number },
): VisitorEvent | null {
  if (!isVisitorEventKind(input.kind)) return null;

  const occurredMs = typeof input.occurredAt === 'string' ? Date.parse(input.occurredAt) : NaN;
  const trusted = Number.isFinite(occurredMs)
    && Math.abs(context.nowMs - occurredMs) < VISITOR_EVENT_LIMITS.maxClockSkewMs;

  return {
    visitorId: context.visitorId,
    visitId: isVisitId(input.visitId) ? input.visitId : null,
    persona: context.personaOf(input.persona),
    kind: input.kind.toLowerCase(),
    path: normalizePath(input.path),
    metadata: normalizeMetadata(input.metadata),
    occurredAt: trusted ? new Date(occurredMs) : new Date(context.nowMs),
  };
}

/**
 * Strip a path down to the thing the graph groups by.
 *
 * The query string is dropped: `/pricing?utm_source=x` and `/pricing` are the
 * same STEP, and keeping them apart would shatter the busiest node in the graph
 * into a long tail of one-visitor variants. Attribution already lives on the
 * lead row, so nothing is lost by not carrying it here too.
 */
export function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutQuery = value.split(/[?#]/)[0]!.trim();
  if (!withoutQuery) return null;
  const trimmed = withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') || '/' : withoutQuery;
  return trimmed.slice(0, VISITOR_EVENT_LIMITS.maxPathChars);
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const serialized = safeStringify(value);
  if (!serialized || serialized.length > VISITOR_EVENT_LIMITS.maxMetadataChars) return null;
  return value as Record<string, unknown>;
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    // Circular metadata is a caller bug; dropping the metadata beats dropping
    // the event, which still carries the kind, path and time that matter most.
    return null;
  }
}
