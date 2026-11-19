/**
 * A size budget for a copied triage report.
 *
 * Per-payload capping alone is not enough. A 26-call run with a 4 KB cap per
 * payload can still assemble a 120 KB report, and every paste target downstream
 * (issue trackers, chat clients, a model's own context) truncates from the END —
 * which is precisely where the failure being triaged lives. The pasted report
 * this module exists for ended mid-sentence with "[Message truncated - exceeded
 * 50,000 character limit]", losing every turn after the tenth.
 *
 * So the report budgets itself, and spends what it has where the information is:
 *
 *  1. The header, diagnostics and signals are never charged — they are the part a
 *     reader acts on, and they are bounded already.
 *  2. Payloads are charged against a shared pool. As the pool drains, the
 *     per-payload cap SHRINKS, so an early verbose tool result cannot eat the
 *     allowance the later ones need.
 *  3. A payload byte-identical to one already emitted is replaced by a back
 *     reference. A run that read the same file seven times pays for it once —
 *     and the back reference is itself a finding, since it makes the repetition
 *     visible in the body rather than only in the diagnostics block. A TINY repeat
 *     (a 39-char `{"cwd": …}` input) is cheaper than its own back reference, so it is
 *     reprinted verbatim instead — never dropped: every call stays in the report.
 *  4. Payloads are RANKED (`payloadPriority.ts`): mutations, diffs, ship output, errors
 *     and the conversation's own words are high priority, and room is held back for the
 *     high-priority payloads still to come — sized to their actual demand when the caller
 *     declares it — so the reads at the start of a run cannot starve the change at its
 *     end. When the demand is NOT declared the hold is only a guess, so a normal payload
 *     is never squeezed out by it: while the pool has room it gets at least the floor.
 *     When it IS declared, the hold is exactly what is still to come and is kept for it.
 *
 * The result is a report that stays under the limit end-to-end instead of being
 * complete for its first third and absent for the rest.
 */

import { payloadPriority, type PayloadPriority } from './payloadPriority';

export { payloadPriority, type PayloadPriority };

/** What a budget was asked to enforce. */
export interface PayloadBudgetOptions {
  /** Total characters all payloads may consume together. */
  total: number;
  /** Ceiling for any single payload while the pool is full. */
  perPayload: number;
  /**
   * Floor the per-payload cap decays to as the pool drains. Below this a payload
   * is not worth including at all, so it is elided with a marker instead.
   */
  minPayload?: number;
  /**
   * Largest share of `total` (0–1) held for HIGH-priority payloads — see
   * `payloadPriority.ts`. Default {@link DEFAULT_HIGH_PRIORITY_RESERVE}; 0 disables ranking.
   */
  highPriorityReserve?: number;
  /**
   * Characters of high-priority payload the caller KNOWS are coming (a pre-scan of the
   * transcript). The hold is `min(share × total, demand)`, so room is never held for
   * payloads that do not exist. Omitted ⇒ the full share is held.
   */
  highPriorityDemand?: number;
  /**
   * Characters set aside BEFORE anything else for the payloads charged as `'tail'` — the
   * report's END: the final assistant reply and the last user message. Released only to
   * them, so a chat whose high-priority demand exceeds the whole budget still ends on its
   * last exchange instead of "…omitted". Default 0.
   */
  tailReserve?: number;
}

/**
 * How a payload is charged: its {@link PayloadPriority}, or `'tail'` — high priority that
 * may also spend the {@link PayloadBudgetOptions.tailReserve}.
 */
export type ChargePriority = PayloadPriority | 'tail';

export interface PayloadBudgetStats {
  /** Characters actually emitted into payload blocks. */
  spent: number;
  /** Payloads shortened because the pool had run low. */
  trimmed: number;
  /** Payloads replaced by a back reference to an identical earlier one. */
  deduped: number;
  /** Characters saved by those back references — the cost of the repetition. */
  dedupedChars: number;
  /** Tiny byte-identical repeats reprinted verbatim (cheaper than a back reference). */
  tinyRepeats: number;
}

export interface PayloadBudget {
  /**
   * Charge a payload against the budget and return what should be printed for it.
   * `label` names the block (e.g. `read_file Output`) so a back reference can say
   * what it points at. `priority` overrides the structural ranking.
   */
  cap(payload: string, label: string, maxChars?: number, priority?: ChargePriority): string;
  /** The whole fenced block for a payload — `label:`, the fence, the charged payload — or nothing for an empty one. */
  fence(label: string, payload: string, maxChars?: number, priority?: ChargePriority): string[];
  stats(): PayloadBudgetStats;
  /** A one-line note for the report when the budget actually bit; null otherwise. */
  note(): string | null;
}

const DEFAULT_MIN_PAYLOAD = 240;
/** Largest share of the pool held back for mutations, diffs, ship output, errors and the conversation. */
export const DEFAULT_HIGH_PRIORITY_RESERVE = 0.3;
/** A repeat at or under this many chars costs less than the back reference that would replace it. */
const TINY_REPEAT_CHARS = 160;

/**
 * Create a budget. Stateful by design — the caller walks the transcript once, in
 * order, charging each payload as it goes.
 */
export function createPayloadBudget(opts: PayloadBudgetOptions): PayloadBudget {
  // The floor can never exceed the ceiling: a caller that asks for small blocks must
  // get small blocks, not the default floor silently overriding their cap.
  const minPayload = Math.min(opts.minPayload ?? DEFAULT_MIN_PAYLOAD, opts.perPayload);
  const total = Math.max(0, opts.total);
  const share = Math.min(1, Math.max(0, opts.highPriorityReserve ?? DEFAULT_HIGH_PRIORITY_RESERVE));
  const demandDeclared = opts.highPriorityDemand != null;
  const demand = demandDeclared ? Math.max(0, opts.highPriorityDemand!) : Number.POSITIVE_INFINITY;
  /** Room set aside before anything else for the `tail` payloads alone (the report's END). */
  let tailLeft = Math.min(total, Math.max(0, opts.tailReserve ?? 0));
  /** Room still held for high-priority payloads to come; spending one releases its share. */
  let held = Math.min(Math.floor((total - tailLeft) * share), demand);
  let remaining = total;
  let spent = 0;
  let trimmed = 0;
  let deduped = 0;
  let dedupedChars = 0;
  let tinyRepeats = 0;
  /** First place each distinct payload appeared, so repeats can point back at it. */
  const seen = new Map<string, { ordinal: number; label: string }>();
  let ordinal = 0;

  const charge = (chars: number, high: boolean, tail: boolean): void => {
    remaining -= chars;
    spent += chars;
    if (tail) tailLeft = Math.max(0, tailLeft - chars);
    held = Math.max(0, Math.min(held - (high ? chars : 0), remaining - tailLeft));
  };

  const cap = (payload: string, label: string, maxChars?: number, priority?: ChargePriority): string => {
    if (!payload) return payload;
    // A per-call ceiling replaces `perPayload` for THIS payload only (secondary content
    // such as model reasoning takes a lower one) — same pool, same decay, same dedupe.
    const ceiling = maxChars != null && maxChars > 0 ? maxChars : opts.perPayload;
    const floor = Math.min(minPayload, ceiling);
    ordinal += 1;

    // A byte-identical repeat is charged nothing: it carries no information the earlier
    // copy did not. A tiny one is cheaper than its own back reference, so it is reprinted.
    const prior = seen.get(payload);
    if (prior) {
      if (payload.length <= TINY_REPEAT_CHARS) {
        tinyRepeats += 1;
        return payload;
      }
      deduped += 1;
      dedupedChars += payload.length;
      return `…(identical to the ${ordinalWord(prior.ordinal)} payload in this report — ${prior.label}, ${formatCount(payload.length)} chars. Repeated verbatim; not reprinted.)`;
    }
    seen.set(payload, { ordinal, label });

    const tail = priority === 'tail';
    const high = tail || (priority ?? payloadPriority(label, payload)) === 'high';
    // Only a `tail` payload may spend the room set aside for the report's end.
    const room = tail ? remaining : remaining - tailLeft;
    // The cap decays with the pool so the tail of the report is not starved by its head.
    // A NORMAL payload may not spend the room held for high-priority payloads still to
    // come — except the floor when that hold is only a guess (no declared demand).
    const available = high ? Math.max(0, room) : Math.max(0, room - held);
    const capChars = Math.max(floor, Math.min(ceiling, available));
    // A payload within the floor is always printed — a 30-char `{path}` input is cheaper
    // than the marker that would replace it, and every call must stay in the report.
    if (payload.length <= capChars) {
      // Within the floor but past what a normal payload may spend: printed, but not charged
      // against the hold — a run of tiny inputs must not eat the room kept for the commit.
      // (`cutMiddleToFit` remains the report's hard ceiling.)
      if (high || payload.length <= available) charge(payload.length, high, tail);
      return payload;
    }
    if (room < floor) {
      trimmed += 1;
      return `…(${formatCount(payload.length)} chars omitted — the report hit its size budget. The full result is on the live timeline.)`;
    }
    // With a DECLARED demand the hold is exactly what is still to come, so a normal payload
    // may not dip into it (its floor would be taken from a known change or the final reply).
    // With demand unknown the hold is a guess, and a normal payload keeps its floor.
    if (!high && available < floor && demandDeclared) {
      trimmed += 1;
      return `…(${formatCount(payload.length)} chars omitted — the report hit its size budget; the remaining room is held for the changes, errors and replies still to come. The full result is on the live timeline.)`;
    }
    trimmed += 1;
    charge(capChars, high, tail);
    return `${payload.slice(0, capChars)}\n…(+${formatCount(payload.length - capChars)} chars truncated — full result is on the live timeline)`;
  };

  return {
    cap,

    fence(label, payload, maxChars, priority) {
      return payload ? [`${label}:`, '```', cap(payload, label, maxChars, priority), '```'] : [];
    },

    stats() {
      return { spent, trimmed, deduped, dedupedChars, tinyRepeats };
    },

    note() {
      if (trimmed === 0 && deduped === 0) return null;
      const parts: string[] = [];
      if (trimmed) parts.push(`${trimmed} oversized payload(s) shortened (changes, diffs, errors and the conversation kept ahead of reads)`);
      if (deduped) {
        parts.push(
          `${deduped} payload(s) were byte-identical repeats and are shown as back references (${(dedupedChars / 1024).toFixed(1)} KB of repetition — itself a signal, see the Progress lines)`,
        );
      }
      return `Note: this report is size-budgeted so its END survives pasting — ${parts.join('; ')}. Every turn, tool call and error is still present.`;
    },
  };
}

/**
 * The most characters a copied report may reach. The paste targets this report is written
 * for cut at 50,000 characters FROM THE END; the 2,000 below that is margin for the final
 * newline and for any target that counts differently (CRLF, surrogate pairs).
 */
export const PASTE_SAFE_REPORT_CHARS = 48_000;

/** The paste limit the report is defended against (named in the middle-cut marker). */
export const PASTE_LIMIT_CHARS = 50_000;

const formatCount = (n: number): string => n.toLocaleString('en-US');

/** `s.slice(0, n)` that never leaves a lone high surrogate at the cut. */
function safePrefix(s: string, n: number): string {
  let end = Math.max(0, Math.min(n, s.length));
  if (end > 0 && end < s.length) {
    const c = s.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  }
  return s.slice(0, end);
}

/** The last `n` characters of `s` that never start on a lone low surrogate. */
function safeSuffix(s: string, n: number): string {
  let start = Math.max(0, s.length - Math.max(0, n));
  if (start > 0 && start < s.length) {
    const c = s.charCodeAt(start);
    if (c >= 0xdc00 && c <= 0xdfff) start += 1;
  }
  return s.slice(start);
}

/**
 * Bound one block of text to `max` characters by cutting its MIDDLE (head and tail kept,
 * one marker between). Used for unbounded free text — a conversation error, a chat title.
 * The ONE implementation lives in `@builderforce/tool-output-policy`; its default marker is
 * this report's `…(N chars omitted from the middle)…` line.
 */
export { truncateMiddle } from '@builderforce/tool-output-policy';

/**
 * Last-resort guarantee behind the budget: join `head` + `timeline` + `tail` so that the
 * result is ALWAYS at most `ceiling` characters. If it does not already fit, the MIDDLE of
 * the timeline is cut — its start and (the larger share of) its end are kept — with one
 * marker line. If head + tail + marker alone exceed the ceiling, the timeline is dropped
 * entirely and the head is truncated from its END (its first lines — the verdict and
 * diagnostics — survive); the tail (last turns' note, JSON) is kept whole. Cuts land on
 * line boundaries where one exists and never split a surrogate pair.
 */
export function cutMiddleToFit(head: string, timeline: string, tail: string, ceiling: number): string {
  const join = (...parts: string[]): string => parts.filter((s) => s.length > 0).join('\n');
  const whole = join(head, timeline, tail);
  if (whole.length <= ceiling) return whole;

  const marker = (omitted: number): string =>
    `…(${formatCount(omitted)} chars of the middle of the timeline omitted to keep this report under the ${formatCount(PASTE_LIMIT_CHARS)}-character paste limit)`;
  const markerMax = marker(timeline.length).length;

  // Newlines between head / middle / tail, and inside the middle (start, marker, end).
  const overhead = 2 + 2;
  const room = ceiling - head.length - tail.length - markerMax - overhead;
  if (room < 0) {
    // Head + tail do not leave room even for a marker: truncate the head, keep the tail.
    const headNote = '…(diagnostics header truncated to keep this report within the paste limit)';
    const headRoom = Math.max(0, ceiling - tail.length - marker(timeline.length).length - headNote.length - 3 - 2);
    let h = safePrefix(head, headRoom);
    const nl = h.lastIndexOf('\n');
    if (nl > 0 && h.length < head.length) h = h.slice(0, nl);
    const out = join(h, headNote, marker(timeline.length), tail);
    // Pathological: the tail alone is over the ceiling. Keep its END (the JSON block).
    return out.length <= ceiling ? out : safeSuffix(out, ceiling);
  }

  const front = Math.floor(room / 3);
  const back = room - front;
  let start = safePrefix(timeline, front);
  const startNl = start.lastIndexOf('\n');
  if (startNl > 0) start = start.slice(0, startNl);
  let end = back > 0 ? safeSuffix(timeline, back) : '';
  const endNl = end.indexOf('\n');
  if (endNl >= 0 && endNl < end.length - 1) end = end.slice(endNl + 1);

  const omitted = Math.max(0, timeline.length - start.length - end.length);
  return join(head, join(start, marker(omitted), end), tail);
}

/** 1 → "1st", 2 → "2nd" … for a readable back reference. */
function ordinalWord(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
