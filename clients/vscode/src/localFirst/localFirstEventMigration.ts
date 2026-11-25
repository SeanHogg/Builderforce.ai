/**
 * The ONE-TIME event-backlog migration of the VSIX journal (`planEventBacklogMigration`), its
 * backup, and the way back.
 *
 * Run at open, once the journal is adopted and healthy. A store written before the marker rules
 * carries tens of thousands of payload copies — never-sent unbound events, and bound imports
 * queued with the row's payload; the plan turns those into markers (only where the payload is
 * exactly what the row gives) and drops orphans and acknowledged leftovers. Committed as ORDINARY
 * delta frames under the cross-window lock, so another window catches up on them like any other
 * commit and no format bump is needed: an unbound marker is the shape builds have written since
 * 2026-11-01, and a bound marker is FENCED so an older build never sends it
 * (`recordPayloadMarker.ts`). The plan's last frame records the migration in the store, so it runs
 * once; a kill between frames leaves a consistent journal and the next open plans the rest.
 *
 * BACKUP: before the first frame the journal as it stood is copied next to it
 * (`<journal>.pre-migration.bak`: temp + fsync + durable rename), with a sidecar
 * (`<journal>.pre-migration.json`) naming when and which events were marked. It is kept until
 * every marked event has synced (left the journal) AND seven days have passed — whichever is
 * later. `restorePreMigrationBackup` puts it back and disables the migration for that store.
 */

import nodeFs from "node:fs";
import {
  eventBacklogMigrated,
  planEventBacklogMigration,
  type EventBacklogMigrationPlan,
  type LocalFirstDelta,
  type LocalFirstSnapshot,
} from "@builderforce/local-first";
import { renameDurably, temporaryPathFor, writeWhole } from "./localFirstAtomicFile";
import { yieldToEventLoop } from "./localFirstJournalIo";

const fs = nodeFs.promises;

export const PRE_MIGRATION_SUFFIX = ".pre-migration.bak";
/** The backup's sidecar: when the migration ran and which events it marked. */
export const PRE_MIGRATION_RECORD_SUFFIX = ".pre-migration.json";
/** Present after a restore: this store is never migrated again. */
export const MIGRATION_DISABLED_SUFFIX = ".migration-disabled";
/** The backup is kept at least this long after the migration. */
export const BACKUP_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

interface MigrationRecord {
  readonly migratedAt: string;
  readonly markedEventIds: readonly string[];
}

export interface EventMigrationPorts {
  readonly journalFile: string;
  /** The committed state, read synchronously. */
  view(): LocalFirstSnapshot;
  /** Run `work` holding the cross-window lock, with the state caught up with the journal. */
  locked<T>(work: () => Promise<T>): Promise<T>;
  /** Append `delta` as one journal frame (fsynced), then apply it to the state. Under the lock. */
  commit(delta: LocalFirstDelta): Promise<void>;
  /** Now, in ms (tests). */
  now?(): number;
}

/** Migrate the backlog if this store never ran it. Returns the plan that was committed, or undefined. */
export async function migrateEventBacklog(ports: EventMigrationPorts): Promise<EventBacklogMigrationPlan | undefined> {
  const journalFile = ports.journalFile;
  // Lock-free first: a migrated store, or one with nothing to migrate (the usual open), never
  // takes the lock and writes nothing — the flag is recorded only with a migration that changed
  // something, so a store with no backlog is planned again (a cheap filter) and never touched.
  if (eventBacklogMigrated(ports.view()) || await exists(`${journalFile}${MIGRATION_DISABLED_SUFFIX}`)) {
    await retireBackup(journalFile, ports.view(), ports.now?.() ?? Date.now());
    return undefined;
  }
  const probe = planEventBacklogMigration(ports.view());
  if (probe.stripped + probe.dropped === 0) return undefined;
  return ports.locked(async () => {
    if (eventBacklogMigrated(ports.view())) return undefined;
    const plan = planEventBacklogMigration(ports.view());
    const changes = plan.stripped + plan.dropped > 0;
    if (!changes) return undefined;
    // The FIRST pre-migration state is the one worth keeping: a resumed migration keeps it.
    if (changes && !(await exists(`${journalFile}${PRE_MIGRATION_SUFFIX}`))) {
      await copyDurably(journalFile, journalFile, `${journalFile}${PRE_MIGRATION_SUFFIX}`);
      const record: MigrationRecord = { migratedAt: new Date(ports.now?.() ?? Date.now()).toISOString(), markedEventIds: plan.markedEventIds };
      await writeDurably(journalFile, `${journalFile}${PRE_MIGRATION_RECORD_SUFFIX}`, JSON.stringify(record));
    }
    for (const delta of plan.deltas) {
      await ports.commit(delta);
      await yieldToEventLoop();
    }
    return changes ? plan : undefined;
  });
}

/**
 * Remove the backup once it has done its job: every event the migration marked has synced (no
 * longer in the journal) and `BACKUP_KEEP_MS` has passed. A backup without its sidecar is kept.
 */
async function retireBackup(journalFile: string, state: LocalFirstSnapshot, now: number): Promise<void> {
  const backup = `${journalFile}${PRE_MIGRATION_SUFFIX}`;
  const sidecar = `${journalFile}${PRE_MIGRATION_RECORD_SUFFIX}`;
  if (!(await exists(backup))) return;
  let record: MigrationRecord;
  try {
    record = JSON.parse(await fs.readFile(sidecar, "utf8")) as MigrationRecord;
  } catch {
    return;
  }
  const migratedAt = Date.parse(record.migratedAt);
  if (!Number.isFinite(migratedAt) || now - migratedAt < BACKUP_KEEP_MS) return;
  const marked = new Set(record.markedEventIds);
  if (state.events.some((event) => marked.has(event.eventId))) return;
  await fs.rm(backup, { force: true });
  await fs.rm(sidecar, { force: true });
}

/**
 * Put the pre-migration journal back (the way back if a migration ever lost data). Run with the
 * store CLOSED in this process, under the cross-window lock (`withLock`): the backup is copied
 * over the journal (temp + fsync + durable rename — another window sees a different file and
 * reloads), and the store is marked so its next open does not migrate it again. Returns false
 * when there is no backup to restore.
 */
export async function restorePreMigrationBackup(
  journalFile: string,
  withLock: <T>(work: () => Promise<T>) => Promise<T>,
): Promise<boolean> {
  const backup = `${journalFile}${PRE_MIGRATION_SUFFIX}`;
  if (!(await exists(backup))) return false;
  return withLock(async () => {
    await writeDurably(journalFile, `${journalFile}${MIGRATION_DISABLED_SUFFIX}`, new Date().toISOString());
    await copyDurably(journalFile, backup, journalFile);
    return true;
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Copy to a temp (the journal's orphan-cleaned temp name), fsync, rename over `to`. */
async function copyDurably(journalFile: string, from: string, to: string): Promise<void> {
  const temporary = temporaryPathFor(journalFile);
  try {
    await fs.copyFile(from, temporary);
    const handle = await fs.open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameDurably(temporary, to);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

/** Write `text` to `to` the same way: temp, fsync, durable rename. */
async function writeDurably(journalFile: string, to: string, text: string): Promise<void> {
  const temporary = temporaryPathFor(journalFile);
  try {
    const handle = await fs.open(temporary, "wx");
    try {
      await writeWhole(handle, new TextEncoder().encode(text), 0);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameDurably(temporary, to);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
