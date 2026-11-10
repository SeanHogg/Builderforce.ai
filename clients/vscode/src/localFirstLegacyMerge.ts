/**
 * Writes an OLD window made to `local-first-v2.journal` after v2 was imported into v3.
 *
 * A window still on the previous VSIX keeps committing to v2, which nothing reads any more.
 * At import, a sidecar (`local-first-v3.import.json`) records the v2 state that was imported:
 * v2's size and mtime, each row's `version`, and each pending event's `eventId`. Every later
 * open compares v2's size and mtime to it (one stat, plus the sidecar) and does nothing when
 * they match. When v2 moved, ONLY what the old window changed since that BASELINE is merged:
 *
 *   - a row whose key (`entityType/id`) is absent from the baseline, or whose `version` is above
 *     the baseline's — and only if v3's row is absent or has a lower `version`;
 *   - an event whose `eventId` is not in the baseline (and not already in v3, pending or
 *     receipted).
 *
 * Comparing v2 to v3 alone would be wrong: v2 is frozen, so a row v3 deleted or an event v3
 * already sent and dropped still sits in it, and merging those would resurrect deletions and
 * send events twice. After a merge the baseline becomes everything v2 now holds, so a repeat
 * open is a no-op and a skipped row is never reconsidered. A crash between the v3 commit and
 * the sidecar write re-merges nothing: the rows are already at their version in v3 and the
 * events already in v3. A row v3 deleted stays deleted. Not merged: rows the old window deleted, mappings, receipts,
 * conflicts, cursors.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";
import { isImported, type JournalEvent, type LocalFirstDelta, type LocalFirstSnapshot } from "@builderforce/local-first";
import { LEGACY_JOURNAL_FILE } from "./localFirstJournalIo";
import { readLegacyJournal } from "./localFirstMigration";

const fs = nodeFs.promises;

export const IMPORT_SIDECAR_FILE = "local-first-v3.import.json";

/** The v2 file as it was when it was last imported or merged. */
export interface LegacyBaseline {
  v2Size: number;
  v2MtimeMs: number;
  /** `entityType/id` → the row's `version`. */
  rows: Record<string, number>;
  eventIds: string[];
}

export interface LegacyStat {
  size: number;
  mtimeMs: number;
}

const rowKey = (row: { entityType: string; id: string }): string => `${row.entityType}/${row.id}`;

/** v2's size and mtime, or undefined when there is no v2. Take it BEFORE reading v2. */
export async function statLegacyJournal(directory: string): Promise<LegacyStat | undefined> {
  try {
    const stat = await fs.stat(nodePath.join(directory, LEGACY_JOURNAL_FILE));
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** The baseline after `snapshot` (v2's state) has been taken in: it holds everything `previous` did too. */
export function baselineOf(snapshot: LocalFirstSnapshot, stat: LegacyStat, previous?: LegacyBaseline): LegacyBaseline {
  const rows: Record<string, number> = { ...previous?.rows };
  for (const row of snapshot.records) {
    const key = rowKey(row);
    rows[key] = Math.max(rows[key] ?? row.version, row.version);
  }
  const eventIds = new Set([...(previous?.eventIds ?? []), ...snapshot.events.map((event) => event.eventId)]);
  return { v2Size: stat.size, v2MtimeMs: stat.mtimeMs, rows, eventIds: [...eventIds] };
}

export async function writeLegacyBaseline(directory: string, baseline: LegacyBaseline): Promise<void> {
  const file = nodePath.join(directory, IMPORT_SIDECAR_FILE);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(baseline), { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function readLegacyBaseline(directory: string): Promise<LegacyBaseline | undefined> {
  let parsed: Partial<LegacyBaseline>;
  try {
    parsed = JSON.parse(await fs.readFile(nodePath.join(directory, IMPORT_SIDECAR_FILE), "utf8")) as Partial<LegacyBaseline>;
  } catch {
    // No sidecar (v3 was never imported from v2) or one we cannot read: there is nothing to merge against.
    return undefined;
  }
  const valid = typeof parsed.v2Size === "number" && typeof parsed.v2MtimeMs === "number"
    && !!parsed.rows && typeof parsed.rows === "object" && Array.isArray(parsed.eventIds);
  return valid ? parsed as LegacyBaseline : undefined;
}

/**
 * The baseline and v2's current stat when v2 MOVED since the baseline; undefined (do nothing)
 * for no v2, no sidecar, or the same size and mtime. Costs one stat plus the sidecar read.
 */
export async function legacyMoved(directory: string): Promise<{ baseline: LegacyBaseline; stat: LegacyStat } | undefined> {
  const stat = await statLegacyJournal(directory);
  if (!stat) return undefined;
  const baseline = await readLegacyBaseline(directory);
  if (!baseline) return undefined;
  return baseline.v2Size === stat.size && baseline.v2MtimeMs === stat.mtimeMs ? undefined : { baseline, stat };
}

export interface LegacyMerge {
  /** What to commit to v3 as one frame; undefined when the old window changed nothing that applies. */
  delta: LocalFirstDelta | undefined;
  rows: number;
  events: number;
  /** Write this to the sidecar AFTER the delta is durable. */
  baseline: LegacyBaseline;
}

/** The merge rule, pure: what in `legacy` the old window changed since `baseline` and `current` (v3) lacks. */
export function planLegacyMerge(baseline: LegacyBaseline, legacy: LocalFirstSnapshot, current: LocalFirstSnapshot): LocalFirstDelta | undefined {
  const versions = new Map(current.records.map((row) => [rowKey(row), row.version]));
  const records = legacy.records.filter((row) => {
    const key = rowKey(row);
    const known = baseline.rows[key];
    if (known !== undefined && row.version <= known) return false;
    const have = versions.get(key);
    // Imported, and now gone from v3: v3 deleted it. An old-window edit does not bring it back.
    if (known !== undefined && have === undefined) return false;
    return have === undefined || have < row.version;
  });
  const seen = new Set([...baseline.eventIds, ...current.events.map((event) => event.eventId), ...current.receipts.map((receipt) => receipt.eventId)]);
  // A receipt can be pruned at compaction (`pruneSettledReceipts`), so `seen` alone may no longer
  // know an event the server took: the row's IMPORTED mapping says the creating write went up.
  const imported = new Set(current.mappings.filter(isImported).map((mapping) => `${mapping.entityType}:${mapping.clientEntityId}`));
  const settled = (event: JournalEvent): boolean =>
    (event.operation === "create" || event.operation === "import") && imported.has(`${event.entityType}:${event.clientEntityId}`);
  const fresh = legacy.events.filter((event) => !seen.has(event.eventId) && !settled(event)).sort((a, b) => a.localSequence - b.localSequence);
  // v2 numbered its events from the same starting point v3 did: renumber so no two share a sequence.
  let next = current.nextSequence;
  const events: JournalEvent[] = fresh.map((event) => ({ ...event, localSequence: next++ }));
  if (records.length === 0 && events.length === 0) return undefined;
  return {
    ...(records.length > 0 ? { records } : {}),
    ...(events.length > 0 ? { events, nextSequence: next } : {}),
  };
}

/**
 * Under the lock, with `current` the v3 state just caught up to: re-check that v2 moved (another
 * window may have merged), read v2, and plan the merge. Undefined when there is nothing to do.
 */
export async function readLegacyMerge(
  directory: string,
  current: LocalFirstSnapshot,
  pause: () => Promise<void>,
): Promise<LegacyMerge | undefined> {
  const moved = await legacyMoved(directory);
  if (!moved) return undefined;
  // `moved.stat` was taken before this read: a write landing during it only makes the next open re-check.
  const legacy = await readLegacyJournal(directory, pause);
  if (!legacy) return undefined;
  const delta = planLegacyMerge(moved.baseline, legacy, current);
  return {
    delta,
    rows: delta?.records?.length ?? 0,
    events: delta?.events?.length ?? 0,
    baseline: baselineOf(legacy, moved.stat, moved.baseline),
  };
}
