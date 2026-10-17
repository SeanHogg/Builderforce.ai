import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/**
 * autoExecBlockMemo — lets the auto-exec sweep skip a candidate whose last verdict was
 * a block and whose deciding inputs have not changed since.
 *
 * WHY. Every active tick the sweep fed each of up to 400 candidates through the full
 * lane trigger (~10 neon-http round trips each), and on a stalled board almost all of
 * them are refused for the SAME reason as five minutes earlier. Re-asking a question
 * whose inputs are unchanged cannot produce a different answer, so the answer is kept.
 *
 * WHAT DECIDES A BLOCK, and how each kind is keyed:
 *   • The ticket row and its run history — lane (status), owner, `updated_at`, and the
 *     newest execution id. A lane move, an edit, a reassignment or any new run (a human
 *     Run-now, a reviewer round-trip) changes the fingerprint and forces re-evaluation.
 *     Reasons decided by those alone get a long safety ceiling.
 *   • Cooldown — decided by the clock: kept exactly until the back-off window ends.
 *   • Board configuration (lane gate, staffing, agent capabilities, workspace switches)
 *     changes without touching the ticket, and cannot be fingerprinted cheaply, so those
 *     reasons get a short ceiling: staffing a lane is picked up within it.
 *   • Tenant-wide and live-run reasons are never memoised — the sweep gates tenants
 *     before the loop, and a live run already removes the ticket from the window.
 *
 * Stored as ONE KV blob (one read + at most one write per tick), not a key per ticket:
 * 400 KV reads per tick would trade a Postgres cost for a KV quota cost. Fail-open: an
 * unreadable memo is an empty memo — it can cost re-evaluations, never hide a ticket.
 */

const MEMO_KEY = 'auto-exec:blocked-verdicts';
/** Outlives any ceiling below; entries are pruned explicitly on every save. */
const MEMO_TTL_SECONDS = 24 * 60 * 60;

/** Config-dependent blocks: re-checked at least this often. Half the 30-minute cron floor,
 *  so staffing a lane never waits longer than an idle platform already would. */
export const CONFIG_BLOCK_CEILING_MS = 15 * 60_000;
/** Fingerprint-complete blocks: only a safety net against a missed input. */
export const INTRINSIC_BLOCK_CEILING_MS = 6 * 60 * 60_000;

/** Decided by the ticket row + its run history, both of which the fingerprint carries. */
const INTRINSIC_REASONS = new Set(['terminal_lane', 'not_executable', 'pending_approval', 'run_cap_exhausted', 'same_lane_reentry']);
/** Decided by board/lane/agent/workspace configuration the fingerprint cannot see. */
const CONFIG_REASONS = new Set([
  'no_board', 'no_lane', 'human_gate', 'no_agent', 'managed_no_role', 'lane_unconfigured',
  'capability_mismatch', 'execution_disabled', 'lane_requirement_gate',
]);

export interface BlockVerdict {
  reason: string;
  cooldownRemainingMs?: number | null;
}

/** How long a block may be trusted without re-evaluation, or null when it must not be memoised. */
export function blockCeilingMs(verdict: BlockVerdict): number | null {
  if (verdict.reason === 'cooldown_active') {
    const ms = Number(verdict.cooldownRemainingMs);
    return Number.isFinite(ms) && ms > 0 ? Math.min(ms, INTRINSIC_BLOCK_CEILING_MS) : null;
  }
  if (INTRINSIC_REASONS.has(verdict.reason)) return INTRINSIC_BLOCK_CEILING_MS;
  if (CONFIG_REASONS.has(verdict.reason)) return CONFIG_BLOCK_CEILING_MS;
  return null;
}

/** The inputs of a candidate's verdict that live on the ticket and its runs. */
export interface CandidateInputs {
  status: string;
  updatedAt?: Date | string | null;
  assignedAgentRef?: string | null;
  lastExecutionId?: number | string | null;
}

export function candidateFingerprint(c: CandidateInputs): string {
  const updated = c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt ?? '');
  return [c.status, updated, c.assignedAgentRef ?? '', c.lastExecutionId ?? ''].join('|');
}

interface Entry { f: string; u: number }

export interface BlockMemo {
  /** True when this candidate was blocked with the same inputs and the ceiling has not passed. */
  isFresh(taskId: number, fingerprint: string, nowMs: number): boolean;
  /** Remember a block (or forget the task when the verdict must not be memoised). */
  record(taskId: number, fingerprint: string, verdict: BlockVerdict, nowMs: number): void;
  forget(taskId: number): void;
  /** Persist, keeping only live entries for tasks still in the window. No-op when unchanged. */
  save(liveTaskIds: ReadonlySet<number>, nowMs: number): Promise<void>;
}

function parse(raw: string | null): Map<number, Entry> {
  const out = new Map<number, Entry>();
  if (!raw) return out;
  try {
    const obj = JSON.parse(raw) as Record<string, Entry>;
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (v && typeof v.f === 'string' && Number.isFinite(v.u)) out.set(Number(k), { f: v.f, u: Number(v.u) });
    }
  } catch {
    // A corrupt blob is an empty memo — re-evaluation is always safe.
    return new Map();
  }
  return out;
}

export async function loadBlockMemo(env: Env): Promise<BlockMemo> {
  const store = env.AUTH_CACHE_KV;
  let entries = new Map<number, Entry>();
  if (store) {
    try {
      entries = parse(await store.get(MEMO_KEY));
    } catch (error) {
      reportCaughtError(error, { source: 'application/runtime/autoExecBlockMemo.ts', operation: 'loadBlockMemo', context: { logMessage: '[cron:auto-exec] block memo read failed; evaluating every candidate', details: { error } } });
    }
  }
  let dirty = false;
  const forget = (taskId: number): void => {
    if (entries.delete(taskId)) dirty = true;
  };
  return {
    isFresh(taskId, fingerprint, nowMs) {
      const e = entries.get(taskId);
      return !!e && e.f === fingerprint && nowMs < e.u;
    },
    record(taskId, fingerprint, verdict, nowMs) {
      const ceiling = blockCeilingMs(verdict);
      if (ceiling == null) return forget(taskId);
      entries.set(taskId, { f: fingerprint, u: nowMs + ceiling });
      dirty = true;
    },
    forget,
    async save(liveTaskIds, nowMs) {
      for (const [taskId, e] of entries) {
        if (!liveTaskIds.has(taskId) || e.u <= nowMs) {
          entries.delete(taskId);
          dirty = true;
        }
      }
      if (!dirty || !store) return;
      try {
        await store.put(MEMO_KEY, JSON.stringify(Object.fromEntries(entries)), { expirationTtl: MEMO_TTL_SECONDS });
        dirty = false;
      } catch (error) {
        reportCaughtError(error, { source: 'application/runtime/autoExecBlockMemo.ts', operation: 'saveBlockMemo', context: { logMessage: '[cron:auto-exec] block memo write failed', details: { error } } });
      }
    },
  };
}
