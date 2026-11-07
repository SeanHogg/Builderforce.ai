/**
 * VSIX local project and ticket repository (review G05) — the composition.
 *
 * The sidebar's project, task and board lists are API reads with short-lived memory
 * caches, so with the platform denied a user cannot create, move or archive a single
 * ticket. This is the local system of record for that work: the same `project` /
 * `ticket` records and journal events the web app's `workManagement` writes, committed
 * through the injected transactional store.
 *
 * The parts, each owning one responsibility:
 *
 *   • `localWorkShared.ts`      — errors, statuses, destination rules and the ONE
 *                                 commit + journal helper (`commitRecord`);
 *   • `localProjectRepository`  — projects;
 *   • `localTicketRepository`   — tickets;
 *   • `localWorkOwnership`      — `bindDestination` (explicit ownership, G10).
 *
 * Rules that hold for all of them:
 *
 *   • No network. `bfApi`, the gateway and `fetch` are NOT imported;
 *     `localWorkRepository.test.ts` asserts this file reaches no network.
 *   • Identity is DATA, not a live lookup: the destination comes from an argument, never
 *     from whoever is signed in. With none, a record lands in the UNBOUND partition.
 *   • One transaction commits the record and its journal event, and every mutation is a
 *     compare-and-set on the record version.
 *   • Ids are stable client UUIDs, minted once and never re-keyed; a server id lives in
 *     the store's mapping table, not in the record.
 *
 * The store is a PORT (`LocalFirstStore`): activation passes the VSIX snapshot store and
 * a unit test passes `createMemoryLocalFirstStore()`. This module imports nothing from
 * `vscode`, so it stays testable headlessly.
 */

import type { DestinationBinding, EntityDestination, LocalFirstStore } from "@builderforce/local-first";
import { createProjectRepository } from "./localProjectRepository";
import { createTicketRepository } from "./localTicketRepository";
import { createOwnershipRepository } from "./localWorkOwnership";
import { creationDestination, type WorkRepoContext } from "./localWorkShared";

export interface LocalWorkRepositoryOptions {
  /** The durable transactional store — VSIX snapshot store in the host, memory in tests. */
  store: LocalFirstStore;
  deviceId: string;
  /**
   * The account/tenant binding NEW records are created under. DATA, not a lookup:
   * omit it and every new record is stamped `UNBOUND_DESTINATION`.
   */
  destination?: EntityDestination | DestinationBinding;
  newId?: () => string;
  now?: () => Date;
}

export function createLocalWorkRepository(options: LocalWorkRepositoryOptions) {
  // Fail closed at construction: a host that stuffed the signed-in session into the
  // repository options must not be able to create a single record.
  const destination = creationDestination(options.destination);
  const ctx: WorkRepoContext = {
    store: options.store,
    deviceId: options.deviceId,
    newId: options.newId ?? (() => crypto.randomUUID()),
    now: options.now ?? (() => new Date()),
    stampFor: (proposed) => (proposed === undefined ? destination : creationDestination(proposed)),
  };
  return {
    /** The destination new records are stamped with: bound, or the unbound partition. */
    defaultDestination: destination,
    ...createProjectRepository(ctx),
    ...createTicketRepository(ctx),
    ...createOwnershipRepository(ctx),
  };
}

export type LocalWorkRepository = ReturnType<typeof createLocalWorkRepository>;
