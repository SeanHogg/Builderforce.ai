import { describe, expect, it } from "vitest";
import { createMemoryOutboxStore, createOutbox } from "@builderforce/write-outbox";
import {
  DEAD_LETTER_STORAGE_PREFIX,
  EXPORT_DEAD_LETTERS_COMMAND,
  registerDeadLetterQueue,
  runExportDeadLetters,
  type DeadLetterStorage,
  type DurableDeadLetterView,
} from "./deadLetterCommand";

function memoryStorage(initial: Record<string, unknown> = {}): DeadLetterStorage & { values: Map<string, unknown> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    keys: () => [...values.keys()],
    get: (key) => values.get(key),
    update: async (key, value) => {
      values.set(key, value);
    },
  };
}

describe("builderforce.exportDeadLetters", () => {
  it("exports a durable dead letter and puts it back without fetch", async () => {
    const fetchCalls: string[] = [];
    const sends: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error("platform_network_denied");
    }) as typeof fetch;

    const store = createMemoryOutboxStore<{ text: string }, string>();
    const outbox = createOutbox<{ text: string }, string>({
      work: "history",
      retry: {},
      maxWaitMs: 0,
      store,
      send: async () => {
        sends.push("send");
        throw Object.assign(new Error("HTTP 422"), { status: 422 });
      },
    });

    try {
      await outbox.ready();
      const id = outbox.enqueue("lane", { text: "kept offline" });
      await outbox.flush();
      expect(outbox.exportDeadLetters().map((entry) => entry.id)).toEqual([id]);

      const shown: string[] = [];
      const offered: string[][] = [];
      const notes: string[] = [];
      const result = await runExportDeadLetters({
        showExport: async (content) => {
          shown.push(content);
        },
        offerRepair: async (choices) => {
          offered.push(choices.map((choice) => choice.id));
          return choices[0]?.id;
        },
        showInfo: (message) => {
          notes.push(message);
        },
      }, {
        queues: [{ name: "history", outbox }],
      });

      const document = JSON.parse(shown[0]) as {
        command: string;
        durableDeadLetters: Array<{ id: string; payload: { text: string }; retention: string; repairable: boolean }>;
      };
      expect(document.command).toBe(EXPORT_DEAD_LETTERS_COMMAND);
      expect(document.durableDeadLetters).toEqual([
        expect.objectContaining({
          id,
          queue: "history",
          retention: "durable",
          repairable: true,
          payload: { text: "kept offline" },
        }),
      ]);
      expect(offered).toEqual([[id]]);
      expect(result.repairedId).toBe(id);
      expect(notes.some((note) => note.includes("back on the durable queue") && note.includes("Nothing was sent."))).toBe(true);

      expect(outbox.exportDeadLetters()).toEqual([]);
      expect(outbox.stats().deadLetters).toBe(0);
      expect(outbox.stats().queued).toBe(1);
      const stored = await store.load();
      expect(stored).toEqual([
        expect.objectContaining({
          id,
          retention: "durable",
          item: { text: "kept offline" },
        }),
      ]);
      expect(stored[0]?.deadLetter).toBeUndefined();
      expect(stored[0]?.batch).toBeUndefined();
      expect(sends).toEqual(["send"]);
      expect(fetchCalls).toEqual([]);
    } finally {
      outbox.close();
      globalThis.fetch = previousFetch;
    }
  });

  it("repairs a persisted durable dead letter and leaves telemetry dead, without fetch", async () => {
    const fetchCalls: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error("platform_network_denied");
    }) as typeof fetch;

    const activityKey = `${DEAD_LETTER_STORAGE_PREFIX}activity`;
    const telemetryKey = `${DEAD_LETTER_STORAGE_PREFIX}error-reports`;
    const storage = memoryStorage({
      [activityKey]: [{
        id: "letter-1",
        key: "lane",
        item: { text: "offline fact" },
        seq: 1,
        retention: "durable",
        batch: "batch-1",
        deadLetter: { reason: "HTTP 422", at: "2026-01-01T00:00:00.000Z" },
      }],
      [telemetryKey]: [{
        id: "tel-1",
        key: "lane",
        item: { message: "boom" },
        seq: 1,
        retention: "durable",
        deadLetter: { reason: "HTTP 422", at: "2026-01-01T00:00:00.000Z" },
      }],
      "builderforce.unrelated": [{ id: "nope" }],
    });

    try {
      const offered: DurableDeadLetterView[][] = [];
      const result = await runExportDeadLetters({
        showExport: async () => undefined,
        offerRepair: async (choices) => {
          offered.push([...choices]);
          return choices.find((choice) => choice.id === "letter-1")?.id;
        },
        showInfo: () => undefined,
      }, { storage });

      expect(offered).toEqual([[
        expect.objectContaining({ id: "letter-1", queue: "activity", repairable: true, source: "snapshot" }),
      ]]);
      expect(result.repairedId).toBe("letter-1");
      const saved = storage.get(activityKey) as Array<{ id: string; retention?: string; deadLetter?: unknown; batch?: unknown; item: unknown }>;
      expect(saved).toEqual([
        expect.objectContaining({
          id: "letter-1",
          retention: "durable",
          item: { text: "offline fact" },
        }),
      ]);
      expect(saved[0]?.deadLetter).toBeUndefined();
      expect(saved[0]?.batch).toBeUndefined();
      const telemetry = storage.get(telemetryKey) as Array<{ deadLetter?: unknown }>;
      expect(telemetry[0]?.deadLetter).toBeDefined();
      expect(fetchCalls).toEqual([]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("exports a dead letter that exists only on a registered live queue and repairs that queue, without fetch", async () => {
    const fetchCalls: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error("platform_network_denied");
    }) as typeof fetch;

    const sends: string[] = [];
    const store = createMemoryOutboxStore<{ text: string }, string>();
    const outbox = createOutbox<{ text: string }, string>({
      work: "history",
      retry: {},
      maxWaitMs: 0,
      store,
      send: async () => {
        sends.push("send");
        throw Object.assign(new Error("HTTP 422"), { status: 422 });
      },
    });

    const liveKey = `${DEAD_LETTER_STORAGE_PREFIX}live-only`;
    const storage = memoryStorage({ [liveKey]: [] });
    let unregister: (() => void) | undefined;
    try {
      await outbox.ready();
      const id = outbox.enqueue("lane", { text: "only in memory" });
      await outbox.flush();
      expect(outbox.exportDeadLetters().map((entry) => entry.id)).toEqual([id]);
      expect(storage.get(liveKey)).toEqual([]);

      unregister = registerDeadLetterQueue({ name: "live-only", outbox });

      const shown: string[] = [];
      const notes: string[] = [];
      const result = await runExportDeadLetters({
        showExport: async (content) => {
          shown.push(content);
        },
        offerRepair: async (choices) => choices.find((choice) => choice.id === id)?.id,
        showInfo: (message) => {
          notes.push(message);
        },
      }, { storage });

      const document = JSON.parse(shown[0]) as {
        durableDeadLetters: Array<{ id: string; queue: string; source: string; payload: { text: string }; repairable: boolean }>;
      };
      expect(document.durableDeadLetters).toEqual([
        expect.objectContaining({
          id,
          queue: "live-only",
          source: "queue",
          repairable: true,
          payload: { text: "only in memory" },
        }),
      ]);
      expect(result.repairedId).toBe(id);
      expect(notes.some((note) => note.includes("back on the durable queue") && note.includes("Nothing was sent."))).toBe(true);
      expect(outbox.exportDeadLetters()).toEqual([]);
      expect(outbox.stats().deadLetters).toBe(0);
      expect(outbox.stats().queued).toBe(1);
      const stored = await store.load();
      expect(stored[0]?.deadLetter).toBeUndefined();
      expect(stored[0]?.item).toEqual({ text: "only in memory" });
      expect(storage.get(liveKey)).toEqual([]);
      expect(sends).toEqual(["send"]);
      expect(fetchCalls).toEqual([]);
    } finally {
      unregister?.();
      outbox.close();
      globalThis.fetch = previousFetch;
    }
  });
});
