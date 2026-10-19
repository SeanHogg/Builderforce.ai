/**
 * Person-visible export and repair for durable dead letters.
 *
 * Calls the write-outbox export, requeue, and repair APIs. It does not send,
 * flush, or retry, and it does not construct a second outbox.
 *
 * The activity, run-outcomes, error-reports, and brain-turns queues register
 * the outbox they already own. Export and repair then see those in-memory dead
 * letters, and a repair updates that live queue rather than only the snapshot
 * it persists. A queue that has not registered is still read from
 * `builderforce.outbox.<name>`; repairing that snapshot does not reach a queue
 * already loaded in this window. Nothing here calls the platform.
 */

import {
  exportDeadLetters,
  exportDeadLettersForRepair,
  requeueDeadLetter,
  repairDeadLetter as repairDeadLetterEntry,
  type DeadLetterStayReason,
  type OutboxEntry,
} from "@builderforce/write-outbox";

export const EXPORT_DEAD_LETTERS_COMMAND = "builderforce.exportDeadLetters";

/** Snapshot key prefix used by `durableOutboxStore`. */
export const DEAD_LETTER_STORAGE_PREFIX = "builderforce.outbox.";

export interface DeadLetterQueue {
  name: string;
  outbox: {
    exportDeadLetters(): readonly OutboxEntry<unknown, unknown>[];
    repairDeadLetter(id: string): Promise<boolean>;
    ready?(): Promise<void>;
  };
}

export interface DeadLetterStorage {
  keys(): readonly string[];
  get(key: string): unknown;
  update(key: string, value: unknown): Promise<void> | PromiseLike<void>;
}

export interface DurableDeadLetterView {
  id: string;
  queue: string;
  reason: string;
  occurredAt: string;
  payload: unknown;
  retention: "durable";
  repairable: boolean;
  whyNot?: DeadLetterStayReason;
  source: "queue" | "snapshot";
}

export interface DeadLetterCommandUi {
  showExport(content: string): Promise<void>;
  /** Return the id of the letter to put back, or undefined to export only. */
  offerRepair(choices: readonly DurableDeadLetterView[]): Promise<string | undefined>;
  showInfo(message: string): void | Promise<void>;
}

export interface ExportDeadLettersResult {
  letters: readonly DurableDeadLetterView[];
  repairedId?: string;
}

const registered = new Map<string, DeadLetterQueue>();

/** A live queue can register the outbox it already owns. Returns an unregister. */
export function registerDeadLetterQueue(queue: DeadLetterQueue): () => void {
  registered.set(queue.name, queue);
  return () => {
    if (registered.get(queue.name) === queue) registered.delete(queue.name);
  };
}

function isStoredEntry(value: unknown): value is OutboxEntry<unknown, unknown> {
  return typeof value === "object"
    && value !== null
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { seq?: unknown }).seq === "number";
}

function copyEntry(entry: OutboxEntry<unknown, unknown>): OutboxEntry<unknown, unknown> {
  const copy: OutboxEntry<unknown, unknown> = { ...entry };
  if (entry.deadLetter) copy.deadLetter = { ...entry.deadLetter };
  return copy;
}

function copyStored(raw: unknown): OutboxEntry<unknown, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStoredEntry).map(copyEntry);
}

function toSource(queue: string, entry: OutboxEntry<unknown, unknown>) {
  return {
    id: entry.id,
    queue,
    key: entry.key,
    item: entry.item,
    retention: entry.retention,
    deadLetter: entry.deadLetter,
  };
}

function renderExport(letters: readonly DurableDeadLetterView[]): string {
  return JSON.stringify({
    command: EXPORT_DEAD_LETTERS_COMMAND,
    note: "Repair puts one durable letter back on the queue and does not send it.",
    durableDeadLetters: letters.map((letter) => ({
      id: letter.id,
      queue: letter.queue,
      reason: letter.reason,
      occurredAt: letter.occurredAt,
      payload: letter.payload,
      retention: letter.retention,
      repairable: letter.repairable,
      source: letter.source,
      ...(letter.whyNot ? { whyNot: letter.whyNot } : {}),
    })),
  }, null, 2);
}

interface LetterLocation {
  view: DurableDeadLetterView;
  repair: () => Promise<boolean>;
}

function locationsFor(
  name: string,
  dead: readonly OutboxEntry<unknown, unknown>[],
  source: DurableDeadLetterView["source"],
  repair: (id: string) => Promise<boolean>,
): LetterLocation[] {
  const exported = exportDeadLettersForRepair(dead.map((entry) => toSource(name, entry)), name);
  return exported
    .filter((letter) => letter.retention === "durable" && letter.id !== "")
    .map((letter) => ({
      view: {
        id: letter.id,
        queue: letter.queue || name,
        reason: letter.reason,
        occurredAt: letter.occurredAt,
        payload: letter.payload,
        retention: "durable",
        repairable: letter.repairable,
        whyNot: letter.whyNot,
        source,
      },
      repair: () => repair(letter.id),
    }));
}

async function lettersFromOutbox(queue: DeadLetterQueue): Promise<LetterLocation[]> {
  await queue.outbox.ready?.();
  const copied = exportDeadLetters(queue.outbox.exportDeadLetters());
  return locationsFor(queue.name, copied, "queue", async (id) => {
    const plan = requeueDeadLetter(copied.map((entry) => toSource(queue.name, entry)), id, { queue: queue.name });
    if (!plan || plan.retention !== "durable") return false;
    return queue.outbox.repairDeadLetter(id);
  });
}

async function repairSnapshot(storage: DeadLetterStorage, name: string, id: string): Promise<boolean> {
  const key = `${DEAD_LETTER_STORAGE_PREFIX}${name}`;
  const raw = storage.get(key);
  if (!Array.isArray(raw)) return false;
  const entries = copyStored(raw);
  const plan = requeueDeadLetter(entries.map((entry) => toSource(name, entry)), id, { queue: name });
  if (!plan || plan.retention !== "durable") return false;
  const repaired = repairDeadLetterEntry(entries, id);
  if (!repaired || repaired.deadLetter || repaired.retention !== "durable") return false;
  const next = raw.map((value) => (isStoredEntry(value) && value.id === id ? repaired : value));
  await storage.update(key, next);
  return true;
}

async function lettersFromSnapshot(storage: DeadLetterStorage, name: string): Promise<LetterLocation[]> {
  const dead = exportDeadLetters(copyStored(storage.get(`${DEAD_LETTER_STORAGE_PREFIX}${name}`)));
  return locationsFor(name, dead, "snapshot", (id) => repairSnapshot(storage, name, id));
}

/**
 * Export durable dead letters and, if the person picks one, put it back.
 * Does not flush and does not call the platform.
 */
export async function runExportDeadLetters(
  ui: DeadLetterCommandUi,
  options: {
    queues?: readonly DeadLetterQueue[];
    storage?: DeadLetterStorage;
  } = {},
): Promise<ExportDeadLettersResult> {
  const byName = new Map<string, DeadLetterQueue>();
  for (const queue of [...registered.values(), ...(options.queues ?? [])]) {
    if (!byName.has(queue.name)) byName.set(queue.name, queue);
  }

  const locations: LetterLocation[] = [];
  const seen = new Set<string>();
  const add = (location: LetterLocation): void => {
    const key = `${location.view.queue}\0${location.view.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    locations.push(location);
  };

  for (const queue of byName.values()) {
    try {
      for (const location of await lettersFromOutbox(queue)) add(location);
    } catch {
      // A queue that cannot load is omitted. The others are still exported.
    }
  }
  if (options.storage) {
    for (const storageKey of options.storage.keys()) {
      if (!storageKey.startsWith(DEAD_LETTER_STORAGE_PREFIX)) continue;
      const name = storageKey.slice(DEAD_LETTER_STORAGE_PREFIX.length);
      if (!name || byName.has(name)) continue;
      try {
        for (const location of await lettersFromSnapshot(options.storage, name)) add(location);
      } catch {
        // One bad snapshot does not hide the rest.
      }
    }
  }

  const letters = locations.map((location) => location.view);
  await ui.showExport(renderExport(letters));
  const repairable = letters.filter((letter) => letter.repairable);
  if (repairable.length === 0) {
    await ui.showInfo(
      letters.length === 0
        ? "No durable dead letters are waiting."
        : "Durable dead letters were exported. None can be repaired.",
    );
    return { letters };
  }

  const picked = await ui.offerRepair(repairable);
  if (!picked) return { letters };
  const location = locations.find((item) => item.view.id === picked && item.view.repairable);
  if (!location) {
    await ui.showInfo(`Could not repair ${picked}. It is still a dead letter.`);
    return { letters };
  }

  let repaired = false;
  try {
    repaired = await location.repair();
  } catch {
    repaired = false;
  }
  await ui.showInfo(
    repaired
      ? location.view.source === "snapshot"
        ? `Wrote ${picked} back onto the durable snapshot. Reload the window before a loaded queue can send it. Nothing was sent.`
        : `Put ${picked} back on the durable queue. Nothing was sent.`
      : `Could not repair ${picked}. It is still a dead letter.`,
  );
  return { letters, repairedId: repaired ? picked : undefined };
}
