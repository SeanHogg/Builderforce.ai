/**
 * MK-09-D2 — a CloudRunner handoff that was recorded and never ticked.
 *
 * The 15-minute queued reaper (`QUEUED_DEADLINE_MS`) is not this deadline. A run
 * whose payload carries `handoffRecordedAt` and no `firstTickAt` fails closed once
 * {@link HANDOFF_START_TIMEOUT_MS} has elapsed since the handoff was recorded.
 */
export const HANDOFF_START_TIMEOUT_MS = 2 * 60_000;

export const DROPPED_HANDOFF_REASON =
  'CloudRunner handoff was recorded but the first tick never arrived within the start-timeout.';

function readObject(payload: string | null | undefined): Record<string, unknown> {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stamp(payload: string | null | undefined, key: string, iso: string): string {
  const obj = readObject(payload);
  obj[key] = iso;
  return JSON.stringify(obj);
}

export function withHandoffRecorded(payload: string | null | undefined, atIso: string): string {
  return stamp(payload, 'handoffRecordedAt', atIso);
}

export function withFirstTick(payload: string | null | undefined, atIso: string): string {
  return stamp(payload, 'firstTickAt', atIso);
}

export function hasFirstTick(payload: string | null | undefined): boolean {
  return typeof readObject(payload).firstTickAt === 'string';
}

function isoMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * The dropped-handoff race. A tick (payload stamp, or any row write after the
 * handoff) clears it. Inside the timeout the run is still starting.
 */
export function droppedHandoff(args: {
  payload: string | null | undefined;
  status: string;
  nowMs: number;
  /** Row `updated_at`. A write after the handoff stamp counts as a tick. */
  updatedAtMs?: number | null;
  timeoutMs?: number;
}): { fail: true; reason: string } | { fail: false } {
  if (TERMINAL.has(args.status)) return { fail: false };
  const recorded = isoMs(readObject(args.payload).handoffRecordedAt);
  if (recorded == null) return { fail: false };
  if (hasFirstTick(args.payload)) return { fail: false };
  if (args.updatedAtMs != null && args.updatedAtMs > recorded + 5_000) return { fail: false };
  const timeout = args.timeoutMs ?? HANDOFF_START_TIMEOUT_MS;
  if (args.nowMs - recorded < timeout) return { fail: false };
  return { fail: true, reason: DROPPED_HANDOFF_REASON };
}
