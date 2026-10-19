import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyQueue, createRevokeGate } from "@builderforce/write-outbox";
import {
  bindOutboxSendPermission,
  bindOutboxStorage,
  createDurableOutbox,
  setOutboxScope,
} from "./outboxStorage";

/**
 * G13 — every queue that carries USER WORK is durable, every telemetry-class queue is
 * best-effort, and the decision lives in `classifyQueue` rather than in an ad-hoc string
 * at each constructor.
 *
 * Two halves, because the gap has two shapes:
 *
 *   1. `createDurableOutbox` already resolves `classifyQueue(name)` for itself, so the
 *      named queues are exercised through the real constructor and a refused send. A
 *      durable row dead-letters and stays; a telemetry row is dropped and gone.
 *   2. The failure mode G13 actually guards against is a constructor ADDED later that
 *      builds a queue without classifying it. Four of the five originally-named files
 *      have no outbox at all (they persist through `@builderforce/local-first`
 *      transactions or a fetch), so they cannot be reclassified — the check below turns
 *      "this file has no queue" into an enforced invariant instead of a claim.
 *
 * The four are read as source text, not imported: they pull the extension host.
 */

/** The slice of `Memento` a durable store actually touches. */
class MemoryMemento {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

const host = (): void => {
  bindOutboxStorage({ workspaceState: new MemoryMemento(), secrets: {} } as never);
  bindOutboxSendPermission(createRevokeGate());
  setOutboxScope({ workspace: 7, key: undefined });
};

/** A permanent refusal — the 4xx that must dead-letter history and drop telemetry. */
const refused = (): never => {
  throw Object.assign(new Error("HTTP 422"), { status: 422 });
};

describe("G13 — a refused durable row is kept, a refused telemetry row is dropped", () => {
  it.each([
    ["audit-close", "durable"],
    ["run-checkpoint", "durable"],
    ["fact-publish", "durable"],
    ["ticket-mutation", "durable"],
    ["brain-turns", "durable"],
    ["steps", "durable"],
    ["chat-sync", "durable"],
    ["diagnostics-telemetry", "best-effort"],
    ["session-refresh", "best-effort"],
    ["qa-capture", "best-effort"],
    ["visitor-journey", "best-effort"],
    ["session-replay", "best-effort"],
    ["tool-audit", "best-effort"],
    ["usage-snapshot", "best-effort"],
    ["file-change", "best-effort"],
    ["remote-chunks", "best-effort"],
  ] as const)("classifies %s as %s and behaves that way under a refused send", async (queue, kind) => {
    // The table is the single owner of the decision, so assert against it directly first.
    expect(classifyQueue(queue)?.retention).toBe(kind);
    expect(classifyQueue(queue)?.kind).toBe(kind === "durable" ? "user-work" : "telemetry");

    host();
    // The queue is named with the CANONICAL queue id and no `work` stamp, so the retention
    // exercised below is resolved by `classifyQueue(name)` inside `createDurableOutbox` —
    // exactly the path a live constructor takes. (Naming it `g13-<queue>` instead would
    // make the name unclassified, and the durable half would then pass only because of
    // the outbox's own durable default — a false pass for a table that does nothing.)
    const outbox = createDurableOutbox<{ n: number }>(queue, {
      maxItems: 10,
      maxWaitMs: 60_000,
      send: refused,
    });
    await outbox.ready();
    outbox.enqueue("lane", { n: 1 });
    await outbox.flush();

    if (kind === "durable") {
      // User work: retained until acknowledged, and a permanent refusal is a dead letter.
      expect(outbox.exportDeadLetters()).toHaveLength(1);
      expect(outbox.stats().deadLetters).toBe(1);
      expect(outbox.size()).toBe(1);
    } else {
      // Telemetry: the work already happened; only its record is lost. Never retried.
      expect(outbox.exportDeadLetters()).toHaveLength(0);
      expect(outbox.size()).toBe(0);
      expect(outbox.stats().dropped).toBeGreaterThan(0);
    }
  });

  it("keeps an unstamped unknown name retrying rather than guessing a retention", async () => {
    // `activity` and `run-outcomes` are deliberately unnamed by the table. A queue built
    // without a work stamp must fall back to the outbox's own mode, NOT be guessed at.
    expect(classifyQueue("activity")).toBeUndefined();
    expect(classifyQueue("run-outcomes")).toBeUndefined();

    host();
    const outbox = createDurableOutbox<{ n: number }>("g13-unknown", {
      maxItems: 10,
      maxWaitMs: 60_000,
      send: refused,
    });
    await outbox.ready();
    outbox.enqueue("lane", { n: 1 });
    await outbox.flush();

    // No stamp → no classification → the durable default retains the row.
    expect(outbox.exportDeadLetters()).toHaveLength(1);
    expect(outbox.size()).toBe(1);
  });
});

/**
 * The invariant for the files G13 named. A file that builds a queue must classify it
 * through the shared classifier; a file that builds no queue cannot silently acquire one.
 */
describe("G13 — no VS Code constructor builds an unclassified queue", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = (name: string): string => readFileSync(path.join(here, name), "utf8");

  const NAMED_BY_G13 = [
    "outboxStorage.ts",
    "localAuditStore.ts",
    "runRecovery.ts",
    "sessionsSnapshotStore.ts",
    "auditExecution.ts",
  ];

  /** `createOutbox(` / `createDurableOutbox(` — the only two ways a queue is built here. */
  const CONSTRUCTOR = /\bcreate(?:Durable)?Outbox\b/;

  it.each(NAMED_BY_G13)("%s stamps any queue it builds through the shared classifier", (name) => {
    const text = source(name);
    if (!CONSTRUCTOR.test(text)) {
      // No queue to classify. This file persists through `@builderforce/local-first`
      // transactions, `SecretStorage`, or a fetch — durability is that store's concern,
      // not `classifyQueue`'s.
      expect(text).not.toContain("@builderforce/write-outbox");
      return;
    }
    // It builds a queue, so the retention must come from the one owner of that decision
    // rather than from a literal at the call site.
    expect(text).toMatch(/\bclassifyQueue\b|\bclassifyOutboxWork\b|\bisTelemetryQueue\b|\bisDurableUserWorkQueue\b/);
  });

  it("resolves the named user-work queues through classifyQueue inside createDurableOutbox", () => {
    // The stamp lives in the single shared constructor, so a caller that omits `work`
    // still inherits the right retention from its queue NAME.
    const text = source("outboxStorage.ts");
    expect(text).toContain("classifyQueue(name)");
    expect(text).toContain("rest.work ??");
  });

  it("leaves the step store to the constructor that owns it, not to durableStepHost", () => {
    // `durableStepHost` builds an `OutboxStore`, not an `Outbox`: retention is stamped by
    // whoever constructs the queue around it. Asserting the shape here keeps a future
    // edit from moving queue construction into the store layer by accident.
    const storage = source("outboxStorage.ts");
    const durableStepHost = storage.slice(storage.indexOf("export function durableStepHost"));
    expect(durableStepHost).toContain("storeFor");
    expect(durableStepHost).not.toMatch(/\bcreate(?:Durable)?Outbox\s*\(/);
  });
});