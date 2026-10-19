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
 * G13 for error-reports. The classifier says drop-on-failure. createDurableOutbox
 * otherwise installs retry-until-ack, which would keep a transient failure. This
 * file does not import errorReporter.ts: that module pulls the extension host.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const reporter = readFileSync(path.join(here, "errorReporter.ts"), "utf8");

class MemoryMemento {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
}

const host = (): void => {
  bindOutboxStorage({ workspaceState: new MemoryMemento(), secrets: {} } as never);
  bindOutboxSendPermission(createRevokeGate());
  setOutboxScope({ workspace: 7, key: undefined });
};

const http = (status: number): never => {
  throw Object.assign(new Error(`HTTP ${status}`), { status });
};

describe("errorReporter drop-on-failure", () => {
  it("wires error-reports to the classifier's drop-on-failure, and does not register a dead letter", () => {
    expect(classifyQueue("error-reports")?.onFailure).toBe("drop-on-failure");
    expect(reporter).toContain("isTelemetryQueue");
    expect(reporter).toContain("isDurableUserWorkQueue");
    expect(reporter).toContain(
      'work: classifyQueue("error-reports")?.retention === "durable" ? "history" : "telemetry"',
    );
    expect(reporter).toContain(
      'classifyQueue("error-reports")?.onFailure === "retain-until-acked" ? "retain-until-acked" : "drop-on-failure"',
    );
    expect(reporter).toContain('? "drop-on-failure"');
    expect(reporter).not.toContain("registerDeadLetterQueue");
    expect(reporter).not.toContain("createOutbox");
  });

  it("drops a transient error-report send instead of retaining it until ack", async () => {
    host();
    const reports = createDurableOutbox<{ n: number }>("error-reports-drop", {
      work: classifyQueue("error-reports")?.retention === "durable" ? "history" : "telemetry",
      onFailure: classifyQueue("error-reports")?.onFailure === "retain-until-acked" ? "retain-until-acked" : "drop-on-failure",
      maxItems: 10,
      maxWaitMs: 60_000,
      send: async () => http(500),
    });
    await reports.ready();
    reports.enqueue("lane", { n: 1 });
    await reports.flush();

    expect(reports.size()).toBe(0);
    expect(reports.exportDeadLetters()).toHaveLength(0);
    expect(reports.stats().dropped).toBeGreaterThan(0);
    reports.close();
  });

  it("still retains a transient failure when the caller omits onFailure", async () => {
    host();
    const history = createDurableOutbox<{ n: number }>("error-reports-retain-default", {
      work: "history",
      maxItems: 10,
      maxWaitMs: 60_000,
      send: async () => http(500),
    });
    await history.ready();
    history.enqueue("lane", { n: 1 });
    await history.flush();

    expect(history.size()).toBe(1);
    expect(history.exportDeadLetters()).toHaveLength(0);
    history.close();
  });

  it("classifies a known user-work name as durable when the caller omits the stamp", async () => {
    host();
    expect(classifyQueue("brain-turns")?.retention).toBe("durable");
    expect(classifyQueue("brain-turns")?.onFailure).toBe("retain-until-acked");
    const turns = createDurableOutbox<{ n: number }>("brain-turns", {
      maxItems: 10,
      maxWaitMs: 60_000,
      send: async () => http(422),
    });
    await turns.ready();
    turns.enqueue("lane", { n: 1 });
    await turns.flush();
    const letters = turns.exportDeadLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0]?.retention).toBe("durable");
    expect(await turns.repairDeadLetter(letters[0]!.id)).toBe(true);
    turns.close();
  });

  it("classifies a known telemetry name as drop-on-failure when the caller omits the stamp", async () => {
    host();
    const reports = createDurableOutbox<{ n: number }>("error-reports", {
      maxItems: 10,
      maxWaitMs: 60_000,
      send: async () => http(500),
    });
    await reports.ready();
    reports.enqueue("lane", { n: 1 });
    await reports.flush();
    expect(reports.size()).toBe(0);
    expect(reports.exportDeadLetters()).toHaveLength(0);
    expect(reports.stats().dropped).toBeGreaterThan(0);
    reports.close();
  });

  it("does not guess a retention for an unclassified name", async () => {
    host();
    expect(classifyQueue("activity")).toBeUndefined();
    expect(classifyQueue("run-outcomes")).toBeUndefined();
    const activity = createDurableOutbox<{ n: number }>("activity", {
      maxItems: 10,
      maxWaitMs: 60_000,
      send: async () => http(500),
    });
    await activity.ready();
    activity.enqueue("lane", { n: 1 });
    await activity.flush();
    expect(activity.size()).toBe(1);
    expect(activity.exportDeadLetters()).toHaveLength(0);
    activity.close();
  });
});
