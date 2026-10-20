import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyOutboxWork, classifyQueue, createRevokeGate } from "@builderforce/write-outbox";
import {
  bindOutboxSendPermission,
  bindOutboxStorage,
  createDurableOutbox,
  setOutboxScope,
} from "./outboxStorage";

/**
 * G13 live constructors. The queue table names `activity` and `run-outcomes` as
 * durable retained user-work and aliases `error-reports` onto the best-effort
 * telemetry queue. The constructors stamp a work kind the outbox actually
 * retains or drops. This file does not import those modules: they pull the
 * extension host.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (name: string): string => readFileSync(path.join(here, name), "utf8");

/** Same stamp the constructors pass, so a table change moves the test with them. */
const activityWork = classifyQueue("activity")?.retention === "best-effort" ? "telemetry" : "history";
const runOutcomeWork = classifyQueue("run-outcomes")?.retention === "best-effort" ? "telemetry" : "history";
const errorReportWork = classifyQueue("error-reports")?.retention === "durable" ? "history" : "telemetry";

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

const refused = (): never => {
  throw Object.assign(new Error("HTTP 422"), { status: 422 });
};

describe("live outbox constructors — work kind", () => {
  it("classifies activity and run outcomes as durable history, and error reports as telemetry", () => {
    expect(classifyQueue("activity")?.retention).toBe("durable");
    expect(classifyQueue("run-outcomes")?.retention).toBe("durable");
    expect(classifyQueue("error-reports")?.retention).toBe("best-effort");
    expect(classifyQueue("error-reports")?.kind).toBe("telemetry");
    expect(activityWork).toBe("history");
    expect(runOutcomeWork).toBe("history");
    expect(errorReportWork).toBe("telemetry");
    expect(classifyOutboxWork(activityWork)).toBe("durable");
    expect(classifyOutboxWork(runOutcomeWork)).toBe("durable");
    expect(classifyOutboxWork(errorReportWork)).toBe("best-effort");
  });

  it("stamps that work kind on each live constructor", () => {
    const activity = source("activity.ts");
    const gateway = source("gateway.ts");
    const reporter = source("errorReporter.ts");
    expect(activity).toContain(
      'work: classifyQueue("activity")?.retention === "best-effort" ? "telemetry" : "history"',
    );
    expect(gateway).toContain(
      'work: classifyQueue("run-outcomes")?.retention === "best-effort" ? "telemetry" : "history"',
    );
    expect(gateway).toContain('createDurableOutbox<object>("run-outcomes"');
    expect(gateway).toContain('}, "key")');
    expect(reporter).toContain(
      'work: classifyQueue("error-reports")?.retention === "durable" ? "history" : "telemetry"',
    );
  });

  it("keeps a refused history row and drops a refused telemetry row", async () => {
    host();
    const history = createDurableOutbox<{ n: number }>("g13-history", {
      work: activityWork,
      maxItems: 10,
      maxWaitMs: 60_000,
      send: refused,
    });
    const telemetry = createDurableOutbox<{ n: number }>("g13-telemetry", {
      work: errorReportWork,
      maxItems: 10,
      maxWaitMs: 60_000,
      send: refused,
    });
    await history.ready();
    await telemetry.ready();
    history.enqueue("lane", { n: 1 });
    telemetry.enqueue("lane", { n: 1 });
    await history.flush();
    await telemetry.flush();

    expect(history.exportDeadLetters()).toHaveLength(1);
    expect(history.stats().deadLetters).toBe(1);
    expect(telemetry.exportDeadLetters()).toHaveLength(0);
    expect(telemetry.size()).toBe(0);
    expect(telemetry.stats().dropped).toBeGreaterThan(0);
  });
});
