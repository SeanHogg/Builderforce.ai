import { describe, expect, it } from "vitest";
import {
  classifyUserWorkQueue,
  retentionForQueue,
  UNCLASSIFIED_USER_WORK_QUEUES,
  USER_WORK_QUEUES,
} from "./queueClass.js";

describe("classifyUserWorkQueue", () => {
  it("retains user work until acknowledged", () => {
    for (const name of ["audit close", "run-checkpoint", "fact_publish", "ticket mutation"] as const) {
      const classified = classifyUserWorkQueue(name);
      expect(classified?.retention).toBe("durable");
      expect(classified?.onFailure).toBe("retain-until-acked");
    }
  });

  it("drops diagnostics telemetry and session refresh on failure", () => {
    for (const name of ["diagnostics telemetry", "session-refresh", "refresh sessions"] as const) {
      const classified = classifyUserWorkQueue(name);
      expect(classified?.retention).toBe("best-effort");
      expect(classified?.onFailure).toBe("drop-on-failure");
    }
  });

  it("accepts the live error-reports queue name as diagnostics telemetry", () => {
    expect(classifyUserWorkQueue("error-reports")).toEqual({
      queue: "diagnostics-telemetry",
      retention: "best-effort",
      onFailure: "drop-on-failure",
    });
    expect(retentionForQueue("client-report")).toBe("best-effort");
  });

  it("maps each canonical id to itself", () => {
    for (const queue of USER_WORK_QUEUES) {
      expect(classifyUserWorkQueue(queue)?.queue).toBe(queue);
    }
  });

  it("retains chat history, step rows, and chat sync until acknowledged", () => {
    for (const name of [
      "brain-turns",
      "brain turns",
      "steps:12",
      "builderforce.outbox.steps:9",
      "chat-sync",
      "builderforce-outbox:rovr",
    ] as const) {
      const classified = classifyUserWorkQueue(name);
      expect(classified?.retention).toBe("durable");
      expect(classified?.onFailure).toBe("retain-until-acked");
    }
    expect(classifyUserWorkQueue("steps:12")?.queue).toBe("steps");
    expect(classifyUserWorkQueue("builderforce-outbox:rovr")?.queue).toBe("chat-sync");
    expect(classifyUserWorkQueue("builderforce-outbox:rovr-steps")?.queue).toBe("steps");
  });

  it("drops telemetry-class queues on failure", () => {
    for (const name of [
      "qa-capture",
      "visitor journey",
      "session-replay",
      "tool-audit",
      "usage-snapshot",
      "file-change",
      "remote-chunks",
      "builderforce-outbox:rovr-errors",
    ] as const) {
      const classified = classifyUserWorkQueue(name);
      expect(classified?.retention).toBe("best-effort");
      expect(classified?.onFailure).toBe("drop-on-failure");
    }
    expect(classifyUserWorkQueue("builderforce-outbox:rovr-errors")?.queue).toBe("diagnostics-telemetry");
  });

  it("leaves host-persist unclassified on purpose and records the reason", () => {
    // Deliberate, not an omission: host-persist mixes chat messages with host telemetry,
    // so a single retention is wrong for part of its payload on EVERY delivery, not only
    // on failure. `classifyUserWorkQueue` must not be the thing that guesses.
    expect(classifyUserWorkQueue("host-persist")).toBeUndefined();
    expect(UNCLASSIFIED_USER_WORK_QUEUES["host-persist"]).toBeDefined();
    expect(UNCLASSIFIED_USER_WORK_QUEUES["host-persist"]?.carries).toContain("user work");
    expect(UNCLASSIFIED_USER_WORK_QUEUES["host-persist"]?.reason).toMatch(/mixes chat messages/i);
  });

  it("retains activity and run-outcomes as explicit durable user work", () => {
    // G13c (#5941): both used to resolve to durable only through the mode fallback, which
    // made them load-bearing by accident. The row says it outright instead, and the row is
    // durable — the queue is user work that must survive a refused send, exactly as before.
    for (const name of ["activity", "run-outcomes"] as const) {
      expect(USER_WORK_QUEUES).toContain(name);
      expect(classifyUserWorkQueue(name)).toEqual({
        queue: name,
        retention: "durable",
        onFailure: "retain-until-acked",
      });
      expect(retentionForQueue(name)).toBe("durable");
      // The row and the registry are two views of one decision: a name cannot be both.
      expect(UNCLASSIFIED_USER_WORK_QUEUES[name]).toBeUndefined();
    }
  });

  it("keeps the deliberate-omission registry and the table from drifting apart", () => {
    // The registry and the table must not drift: anything the doc comment lists as
    // deliberately unclassified has to carry a reason, and vice versa.
    const registered = Object.keys(UNCLASSIFIED_USER_WORK_QUEUES).sort();
    expect(registered).toEqual(["host-persist"]);
    for (const name of registered) {
      expect(USER_WORK_QUEUES).not.toContain(name);
      expect(classifyUserWorkQueue(name)).toBeUndefined();
    }
    // And the converse: a row in the table is never also a "deliberate omission".
    for (const queue of USER_WORK_QUEUES) {
      expect(UNCLASSIFIED_USER_WORK_QUEUES[queue]).toBeUndefined();
    }
  });

  it("does not guess a queue this table does not own", () => {
    expect(classifyUserWorkQueue("history")).toBeUndefined();
    expect(classifyUserWorkQueue("")).toBeUndefined();
    expect(classifyUserWorkQueue("   ")).toBeUndefined();
    expect(classifyUserWorkQueue(undefined)).toBeUndefined();
    expect(classifyUserWorkQueue(null)).toBeUndefined();
    expect(retentionForQueue("facts")).toBeUndefined();
  });

  it("pairs retention with exactly one failure policy", () => {
    for (const queue of USER_WORK_QUEUES) {
      const classified = classifyUserWorkQueue(queue);
      expect(classified).toBeDefined();
      if (classified?.retention === "durable") {
        expect(classified.onFailure).toBe("retain-until-acked");
      } else {
        expect(classified?.onFailure).toBe("drop-on-failure");
      }
    }
  });

  it("recognises the close-audit alias", () => {
    expect(classifyUserWorkQueue("close-audit")?.queue).toBe("audit-close");
    expect(retentionForQueue("Audit Close")).toBe("durable");
  });
});
