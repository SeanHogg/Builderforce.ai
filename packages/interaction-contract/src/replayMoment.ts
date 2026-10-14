/**
 * A ticket raised from a replay moment (PRD 33 §5.3.4) — the moment, as data.
 *
 * The player writes it when a person raises a ticket at a point in a recording;
 * the API reads it back to measure the ticket's effect on the release that ships
 * the fix (`application/replay/ticketEffect.ts`). The task row has no metadata
 * column, so the moment rides in the ticket's own description as one trailing
 * HTML comment — invisible in rendered markdown, written and parsed only here so
 * the two ends cannot drift.
 *
 * Pure: no DOM, no I/O.
 */

/** The rollup counter whose before/after a ticket's effect compares (`replay_route_daily`). */
export const REPLAY_MOMENT_METRICS = ['frustrated', 'errors', 'conversions'] as const;
export type ReplayMomentMetric = (typeof REPLAY_MOMENT_METRICS)[number];

export interface ReplayMoment {
  siteId: string;
  recordingId: string;
  atMs: number;
  /** The release the moment was recorded on — the "before". */
  releaseKey: string;
  metric: ReplayMomentMetric;
  /** The templated route the moment happened on (the rollups are per route). */
  route: string;
}

const OPEN = '<!-- bf:replay-moment ';
const CLOSE = ' -->';
const TRAILER = /<!-- bf:replay-moment (\{[^\n]*?\}) -->/;
const FIELD_MAX = 200;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= FIELD_MAX ? value : null;
}

/** Validate an untrusted moment. Null when malformed. */
export function parseReplayMoment(raw: unknown): ReplayMoment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const siteId = text(r.siteId);
  const recordingId = text(r.recordingId);
  const releaseKey = typeof r.releaseKey === 'string' && r.releaseKey.length <= FIELD_MAX ? r.releaseKey : null;
  const route = text(r.route);
  const atMs = typeof r.atMs === 'number' && Number.isFinite(r.atMs) && r.atMs >= 0 ? Math.floor(r.atMs) : null;
  const metric = (REPLAY_MOMENT_METRICS as readonly unknown[]).includes(r.metric) ? (r.metric as ReplayMomentMetric) : null;
  if (!siteId || !recordingId || releaseKey === null || !route || atMs === null || !metric) return null;
  return { siteId, recordingId, atMs, releaseKey, metric, route };
}

/** The trailer appended to a ticket description. `--` is escaped so the comment can never close early. */
export function formatReplayMomentTrailer(moment: ReplayMoment): string {
  const json = JSON.stringify(moment).replace(/--/g, '\\u002d\\u002d');
  return `${OPEN}${json}${CLOSE}`;
}

/** The description a person reads: the trailer removed (a view that renders text verbatim would show it). */
export function stripReplayMomentTrailer(description: string): string {
  return description.replace(TRAILER, '').replace(/\s+$/, '');
}

/** The moment a ticket description carries, or null. */
export function replayMomentFromDescription(description: string | null | undefined): ReplayMoment | null {
  if (!description) return null;
  const match = TRAILER.exec(description);
  if (!match) return null;
  try {
    return parseReplayMoment(JSON.parse(match[1]!));
  } catch {
    return null;
  }
}
