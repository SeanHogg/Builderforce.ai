/**
 * ptoWindows — reading `member_profiles.pto` back.
 *
 * The column has existed since 0116 and has been WRITE-ONLY that entire time: the
 * Google Calendar sync fills it, the profile PUT stores whatever JSON it is handed, and
 * nothing in the product has ever read a block back to make a decision. So this module
 * is the first consumer, and it has to cope with everything that was allowed to be
 * written in the meantime.
 *
 * WHAT IS ACTUALLY IN THE COLUMN. It is `jsonb` with no Drizzle `$type`, no default and
 * no route-boundary validation (`memberRoutes` types the body field `unknown` and stores
 * it verbatim), so a row may hold the intended `[{from,to,reason}]`, a bare object, a
 * string, a number, or null. {@link parsePtoBlocks} therefore validates rather than
 * casts: anything that is not a usable window is dropped, because the failure mode that
 * matters is a malformed block being read as "this person is never on leave" — which is
 * exactly the reading that lets their work be reassigned while they are away.
 *
 * THE DATE SHAPE IS MIXED, BY DESIGN OF THE SOURCE. `derivePto` copies Google's fields
 * straight through, so an all-day out-of-office yields date-only strings
 * (`'2026-08-10'`) while a timed one yields full RFC3339 (`'2026-08-10T09:00:00Z'`), and
 * both shapes coexist in one array. Google's all-day `end.date` is EXCLUSIVE — an OOO
 * covering the 10th and 11th is stored as `{from:'2026-08-10', to:'2026-08-12'}` — so a
 * naive inclusive read would mark someone on leave for a day they were back at work.
 * Both conventions are handled below and pinned by tests.
 */

/** One out-of-office window, as written by the Google Calendar sync. */
export interface PtoBlock {
  /** ISO date (`YYYY-MM-DD`) or full RFC3339 instant. */
  from: string;
  /** Same shapes as `from`. For a date-only pair this is EXCLUSIVE (Google's rule). */
  to: string;
  reason: string;
}

/** A parsed window as half-open milliseconds: `[startMs, endMs)`. */
interface PtoWindow {
  startMs: number;
  endMs: number;
  reason: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * Parse the untyped `pto` column into blocks, dropping anything unusable.
 *
 * Tolerant of a JSON STRING as well as a native array: the column is `jsonb`, but a
 * client that double-encoded its payload would otherwise be silently read as "no leave".
 */
export function parsePtoBlocks(value: unknown): PtoBlock[] {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) as unknown; } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const out: PtoBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    const from = typeof b.from === 'string' ? b.from.trim() : '';
    const to = typeof b.to === 'string' ? b.to.trim() : '';
    if (!from || !to) continue;
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim() : 'Out of office';
    out.push({ from, to, reason });
  }
  return out;
}

/**
 * Turn one block into a half-open `[startMs, endMs)` window, or null when either end is
 * unparseable or the window is empty/inverted.
 *
 * A date-only PAIR is the all-day case and `to` is treated as exclusive (Google's rule).
 * Anything with a time component is treated as literal instants; a date-only `from` with
 * a timed `to` (or vice versa) is a mixed pair we cannot attribute to either convention,
 * so it is read literally — the conservative choice, since it never EXTENDS a window
 * beyond what was written.
 */
function toWindow(b: PtoBlock): PtoWindow | null {
  const bothDateOnly = DATE_ONLY.test(b.from) && DATE_ONLY.test(b.to);
  const startMs = Date.parse(bothDateOnly ? `${b.from}T00:00:00Z` : b.from);
  const rawEnd = Date.parse(bothDateOnly ? `${b.to}T00:00:00Z` : b.to);
  if (!Number.isFinite(startMs) || !Number.isFinite(rawEnd)) return null;

  // An all-day pair whose ends are equal is a single day written inclusively rather than
  // by Google's exclusive rule. Reading it as a zero-length window would mean "no leave
  // at all", so widen it to the whole day — the one case where being generous is right.
  const endMs = bothDateOnly && rawEnd === startMs ? startMs + DAY_MS : rawEnd;
  return endMs > startMs ? { startMs, endMs, reason: b.reason } : null;
}

/**
 * Is this member on approved leave at `at`?
 *
 * Used at ceremony conclude so a person on holiday resolves to 'excused' rather than
 * 'absent' — which matters because 'absent' is an input to the rules that can hand their
 * tickets to an agent. Pure; the caller loads the profile.
 */
export function isOnPtoAt(blocks: PtoBlock[], at: Date): boolean {
  return findPtoAt(blocks, at) !== null;
}

/** The covering window at `at` (for the reason string), or null when not on leave. */
export function findPtoAt(blocks: PtoBlock[], at: Date): PtoWindow | null {
  const t = at.getTime();
  if (!Number.isFinite(t)) return null;
  for (const b of blocks) {
    const w = toWindow(b);
    if (w && w.startMs <= t && t < w.endMs) return w;
  }
  return null;
}
