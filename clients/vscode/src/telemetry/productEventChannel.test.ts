import { describe, expect, it } from "vitest";
import { createOutbox } from "@builderforce/write-outbox";
import {
  createProductEventChannel,
  gatedSend,
  productEventSpans,
  sanitizeProductEvent,
  type ProductEvent,
} from "./productEventChannel";

const NOW = new Date("2026-11-10T12:00:00.000Z");

const delta = {
  name: "delta.computed", surface: "vscode", mode: "interactive", headline: "worse", ms: 412.6,
  files: 3, excluded: 1, introduced: 2, resolved: 0, blocking: 1,
};

function channel(over: { telemetry?: boolean; signedIn?: boolean } = {}) {
  const queued: ProductEvent[] = [];
  const emit = createProductEventChannel({
    telemetryEnabled: () => over.telemetry ?? true,
    signedIn: () => over.signedIn ?? true,
    enqueue: (event) => queued.push(event),
    now: () => NOW,
  });
  return { emit, queued };
}

describe("emitProductEvent", () => {
  it("queues an allowlisted event when telemetry is on and the user is signed in", () => {
    const { emit, queued } = channel();
    emit("delta.computed", delta);
    expect(queued).toEqual([{
      name: "delta.computed", at: NOW.toISOString(),
      props: { surface: "vscode", mode: "interactive", headline: "worse", ms: 412.6, files: 3, excluded: 1, introduced: 2, resolved: 0, blocking: 1 },
    }]);
  });

  it("drops every event when telemetry is disabled", () => {
    const { emit, queued } = channel({ telemetry: false });
    emit("delta.computed", delta);
    expect(queued).toEqual([]);
  });

  it("drops every event when the user is signed out", () => {
    const { emit, queued } = channel({ signedIn: false });
    emit("delta.computed", delta);
    expect(queued).toEqual([]);
  });

  it("drops an event whose name is not allowlisted", () => {
    const { emit, queued } = channel();
    emit("something.else", { files: 1 });
    emit("__proto__", { files: 1 });
    expect(queued).toEqual([]);
  });

  it("strips props that are not allowlisted, and values that are not counts, codes or durations", () => {
    const event = sanitizeProductEvent("delta.computed", {
      files: 2,
      path: "/home/me/repo/src/secret.ts",
      code: "const key = 'sk-live-abc'",
      token: "sk-live-abc",
      headline: "C:\\repo\\src\\a.ts",
      mode: "this is a sentence, not a code",
      ms: Number.NaN,
      excluded: { nested: 1 },
      blocking: Number.POSITIVE_INFINITY,
    }, NOW);
    expect(event?.props).toEqual({ files: 2 });
  });

  it("never throws into the caller", () => {
    const emit = createProductEventChannel({
      telemetryEnabled: () => true,
      signedIn: () => true,
      enqueue: () => {
        throw new Error("queue exploded");
      },
    });
    expect(() => emit("delta.computed", delta)).not.toThrow();
    const broken = createProductEventChannel({
      telemetryEnabled: () => {
        throw new Error("setting unreadable");
      },
      signedIn: () => true,
      enqueue: () => undefined,
    });
    expect(() => broken("delta.computed", delta)).not.toThrow();
  });
});

describe("sending", () => {
  it("swallows a send failure: the batch is dropped, nothing is retried and nothing throws", async () => {
    let attempts = 0;
    const outbox = createOutbox<ProductEvent, string>({
      work: "telemetry",
      maxItems: 25,
      maxWaitMs: 0,
      send: (_key, batch) => gatedSend<ProductEvent>(() => true, async () => {
        attempts++;
        throw Object.assign(new Error("HTTP 500"), { status: 500 });
      })(batch),
    });
    const emit = createProductEventChannel({
      telemetryEnabled: () => true, signedIn: () => true, enqueue: (event) => { outbox.enqueue("vsix", event); }, now: () => NOW,
    });
    expect(() => emit("delta.computed", delta)).not.toThrow();
    await expect(outbox.flush()).resolves.toBeUndefined();
    expect(attempts).toBe(1);
    expect(outbox.size()).toBe(0);
    expect(outbox.exportDeadLetters()).toHaveLength(0);
    expect(outbox.stats().dropped).toBe(1);
  });

  it("drops a queued batch without sending it when telemetry was turned off since", async () => {
    let sent = 0;
    const send = gatedSend<ProductEvent>(() => false, async () => {
      sent++;
    });
    await send([sanitizeProductEvent("delta.computed", delta, NOW)!]);
    expect(sent).toBe(0);
  });

  it("maps each event to one span: name as kind, ms as duration, the other props as the description", () => {
    const event = sanitizeProductEvent("delta.computed", delta, NOW)!;
    expect(productEventSpans([event], "session-1")).toEqual([{
      kind: "delta.computed",
      ts: NOW.toISOString(),
      durationMs: 413,
      agentRole: "vscode",
      description: JSON.stringify({ surface: "vscode", mode: "interactive", headline: "worse", files: 3, excluded: 1, introduced: 2, resolved: 0, blocking: 1 }),
      traceId: "session-1",
    }]);
  });
});
