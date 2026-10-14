/**
 * The billable unit of a kept recording (PRD 33 D4).
 *
 * One unit is one KEPT recording of up to 2 MiB compressed; each further 2 MiB counts
 * again. Events of unkept sessions are never billed, so nothing here is called for
 * them. Pure: the wallet (`application/replay/replayUsage.ts`) decides WHO pays.
 */

/** Compressed bytes one unit covers. */
export const REPLAY_UNIT_BYTES = 2_097_152;

/** `max(1, ceil(bytes / 2 MiB))` — a recording that exists costs at least one unit. */
export function billableUnits(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 1;
  return Math.max(1, Math.ceil(bytes / REPLAY_UNIT_BYTES));
}

/**
 * The unit indexes (1-based) a recording newly crosses when it grows from
 * `chargedUnits` already charged to `bytes`. Empty when no new unit is crossed.
 * Each index is charged once under its own ledger reference, so a retry of the
 * same chunk can never charge an index twice.
 */
export function newUnitIndexes(chargedUnits: number, bytes: number): number[] {
  const from = Math.max(0, Math.floor(chargedUnits));
  const to = billableUnits(bytes);
  const out: number[] = [];
  for (let unit = from + 1; unit <= to; unit++) out.push(unit);
  return out;
}
