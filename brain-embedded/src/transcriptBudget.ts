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
 *     visible in the body rather than only in the diagnostics block.
 *
 * The result is a report that stays under the limit end-to-end instead of being
 * complete for its first third and absent for the rest.
 */

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
}

export interface PayloadBudgetStats {
  /** Characters actually emitted into payload blocks. */
  spent: number;
  /** Payloads shortened because the pool had run low. */
  trimmed: number;
  /** Payloads replaced by a back reference to an identical earlier one. */
  deduped: number;
  /** Characters saved by those back references — the cost of the repetition. */
  dedupedChars: number;
}

export interface PayloadBudget {
  /**
   * Charge a payload against the budget and return what should be printed for it.
   * `label` names the block (e.g. `read_file Output`) so a back reference can say
   * what it points at.
   */
  cap(payload: string, label: string, maxChars?: number): string;
  stats(): PayloadBudgetStats;
  /** A one-line note for the report when the budget actually bit; null otherwise. */
  note(): string | null;
}

const DEFAULT_MIN_PAYLOAD = 240;

/**
 * Create a budget. Stateful by design — the caller walks the transcript once, in
 * order, charging each payload as it goes.
 */
export function createPayloadBudget(opts: PayloadBudgetOptions): PayloadBudget {
  // The floor can never exceed the ceiling: a caller that asks for small blocks must
  // get small blocks, not the default floor silently overriding their cap.
  const minPayload = Math.min(opts.minPayload ?? DEFAULT_MIN_PAYLOAD, opts.perPayload);
  let remaining = Math.max(0, opts.total);
  let spent = 0;
  let trimmed = 0;
  let deduped = 0;
  let dedupedChars = 0;
  /** First place each distinct payload appeared, so repeats can point back at it. */
  const seen = new Map<string, { ordinal: number; label: string }>();
  let ordinal = 0;

  return {
    cap(payload, label, maxChars) {
      if (!payload) return payload;
      // A per-call ceiling replaces `perPayload` for THIS payload only (secondary content
      // such as model reasoning takes a lower one) — same pool, same decay, same dedupe.
      const ceiling = maxChars != null && maxChars > 0 ? maxChars : opts.perPayload;
      const floor = Math.min(minPayload, ceiling);
      ordinal += 1;

      // A byte-identical repeat is charged nothing: it carries no information the
      // earlier copy did not, and naming it as a repeat is more useful than
      // reprinting it.
      const prior = seen.get(payload);
      if (prior) {
        deduped += 1;
        dedupedChars += payload.length;
        return `…(identical to the ${ordinalWord(prior.ordinal)} payload in this report — ${prior.label}, ${payload.length.toLocaleString()} chars. Repeated verbatim; not reprinted.)`;
      }
      seen.set(payload, { ordinal, label });

      // The cap decays with the pool so the tail of the report is not starved by
      // its head. While the pool is healthy this is just `perPayload`.
      const cap = Math.max(floor, Math.min(ceiling, remaining));
      if (payload.length <= cap) {
        remaining -= payload.length;
        spent += payload.length;
        return payload;
      }

      if (remaining < floor) {
        trimmed += 1;
        return `…(${payload.length.toLocaleString()} chars omitted — the report hit its size budget. The full result is on the live timeline.)`;
      }

      trimmed += 1;
      remaining -= cap;
      spent += cap;
      return `${payload.slice(0, cap)}\n…(+${(payload.length - cap).toLocaleString()} chars truncated — full result is on the live timeline)`;
    },

    stats() {
      return { spent, trimmed, deduped, dedupedChars };
    },

    note() {
      if (trimmed === 0 && deduped === 0) return null;
      const parts: string[] = [];
      if (trimmed) parts.push(`${trimmed} oversized payload(s) shortened`);
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

/**
 * Hard guarantee behind the budget: join `head` + `timeline` + `tail` and, if the result
 * still exceeds `ceiling`, cut the MIDDLE of the timeline — keeping its start and (the
 * larger share of) its end — with one marker line. The head (diagnostics) and tail (last
 * error, budget note, JSON) are never cut; if they alone exceed the ceiling the whole
 * timeline is replaced by the marker. Cuts land on line boundaries where one exists.
 */
export function cutMiddleToFit(head: string, timeline: string, tail: string, ceiling: number): string {
  const join = (t: string): string => [head, t, tail].filter((s) => s.length > 0).join('\n');
  const whole = join(timeline);
  if (whole.length <= ceiling) return whole;

  const marker = (omitted: number): string =>
    `…(${omitted.toLocaleString()} chars of the middle of the timeline omitted to keep this report under the 50,000-character paste limit)`;
  // Reserve room for the marker (its number can only be shorter than the full timeline's).
  const room = Math.max(0, ceiling - (whole.length - timeline.length) - marker(timeline.length).length - 2);
  const front = Math.floor(room / 3);
  const back = room - front;

  let start = timeline.slice(0, front);
  const startNl = start.lastIndexOf('\n');
  if (startNl > 0) start = start.slice(0, startNl);
  let end = back > 0 ? timeline.slice(timeline.length - back) : '';
  const endNl = end.indexOf('\n');
  if (endNl >= 0 && endNl < end.length - 1) end = end.slice(endNl + 1);

  const omitted = Math.max(0, timeline.length - start.length - end.length);
  return join([start, marker(omitted), end].filter((s) => s.length > 0).join('\n'));
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
