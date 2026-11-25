import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, type LocalFirstStore } from "@builderforce/local-first";
import { runJournalDeadLetters, type JournalDeadLetterChoice, type JournalDeadLetterUi } from "./journalDeadLetters";

const AT = "2026-10-19T00:00:00.000Z";
const BOUND = { kind: "bound" as const, tenantId: "7" };

async function deadLetter(store: LocalFirstStore, key: string, reason: string) {
  const event = await store.transact((tx) => tx.append({
    idempotencyKey: key, clientEntityId: key, entityType: "ticket", operation: "create",
    schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: { key },
  }));
  await store.transact((tx) => tx.deadLetter(event.eventId, reason, AT));
  return event;
}

function ui(pick?: (choices: readonly JournalDeadLetterChoice[]) => string | undefined) {
  const log: string[] = [];
  const offered: JournalDeadLetterChoice[][] = [];
  const impl: JournalDeadLetterUi = {
    async offerRetry(choices) {
      offered.push([...choices]);
      return pick?.(choices);
    },
    showNone: () => { log.push("none"); },
    showNotRetryable: (count) => { log.push(`not-retryable:${count}`); },
    showRequeued: (choice) => { log.push(`requeued:${choice.eventId}`); },
    showFailed: (choice, detail) => { log.push(`failed:${choice.eventId}:${detail}`); },
  };
  return { impl, log, offered };
}

describe("journal dead letters (the journal branch of builderforce.exportDeadLetters)", () => {
  it("says so when there are none", async () => {
    const harness = ui();
    expect((await runJournalDeadLetters(createMemoryLocalFirstStore(), harness.impl)).letters).toEqual([]);
    expect(harness.log).toEqual(["none"]);
  });

  it("offers only retryable letters and requeues exactly the one chosen", async () => {
    const store = createMemoryLocalFirstStore();
    const permanent = await deadLetter(store, "bad", "ticket_title_invalid");
    const unresolvable = await deadLetter(store, "orphan", "dependency_unresolvable");
    const gaveUp = await deadLetter(store, "stuck", "gave_up:project_unresolved");
    const harness = ui(() => unresolvable.eventId);

    const result = await runJournalDeadLetters(store, harness.impl);

    expect(harness.offered[0]?.map((c) => c.eventId)).toEqual([unresolvable.eventId, gaveUp.eventId]);
    expect(result.letters.map((l) => l.eventId)).toEqual([permanent.eventId, unresolvable.eventId, gaveUp.eventId]);
    expect(result.requeuedEventId).toBeDefined();
    expect(harness.log).toEqual([`requeued:${unresolvable.eventId}`]);
    // One new live event for the chosen write; the other letters and the audit record are untouched.
    const all = await store.read((tx) => tx.pending(BOUND));
    const live = all.filter((e) => !e.deadLetter);
    expect(live.map((e) => e.eventId)).toEqual([result.requeuedEventId]);
    expect(live[0]?.idempotencyKey).toBe("orphan");
    expect(all.filter((e) => e.deadLetter)).toHaveLength(3);
  });

  it("does nothing when the person dismisses the picker", async () => {
    const store = createMemoryLocalFirstStore();
    await deadLetter(store, "orphan", "dependency_unresolvable");
    const harness = ui(() => undefined);
    const result = await runJournalDeadLetters(store, harness.impl);
    expect(result.requeuedEventId).toBeUndefined();
    expect(harness.log).toEqual([]);
    expect((await store.read((tx) => tx.pending(BOUND))).filter((e) => !e.deadLetter)).toEqual([]);
  });

  it("reports that nothing can be retried when every letter is a permanent refusal", async () => {
    const store = createMemoryLocalFirstStore();
    await deadLetter(store, "bad", "ticket_title_invalid");
    const harness = ui();
    await runJournalDeadLetters(store, harness.impl);
    expect(harness.offered).toEqual([]);
    expect(harness.log).toEqual(["not-retryable:1"]);
  });
});
