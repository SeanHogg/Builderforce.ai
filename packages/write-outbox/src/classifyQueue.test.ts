import { describe, expect, it } from "vitest";
import { classifyQueue, isDurableUserWorkQueue, isTelemetryQueue } from "./classifyQueue.js";
import { USER_WORK_QUEUES } from "./queueClass.js";

describe("classifyQueue", () => {
  it("marks every user-work queue durable and retained until acknowledged", () => {
    for (const name of [
      "audit close",
      "run-checkpoint",
      "fact_publish",
      "ticket mutation",
      "brain-turns",
      "steps",
      "chat-sync",
      "history",
      "tickets",
      "audits",
      "facts",
    ] as const) {
      const classified = classifyQueue(name);
      expect(classified?.retention).toBe("durable");
      expect(classified?.onFailure).toBe("retain-until-acked");
      expect(classified?.kind).toBe("user-work");
      expect(isDurableUserWorkQueue(name)).toBe(true);
      expect(isTelemetryQueue(name)).toBe(false);
    }
  });

  it("marks telemetry-class queues best-effort and dropped on failure", () => {
    for (const name of [
      "diagnostics telemetry",
      "session-refresh",
      "refresh sessions",
      "error-reports",
      "client-report",
      "telemetry",
      "qa-capture",
      "visitor journey",
      "session-replay",
      "tool-audit",
      "usage-snapshot",
      "file-changes",
      "remote-chunks",
    ] as const) {
      const classified = classifyQueue(name);
      expect(classified?.retention).toBe("best-effort");
      expect(classified?.onFailure).toBe("drop-on-failure");
      expect(classified?.kind).toBe("telemetry");
      expect(isTelemetryQueue(name)).toBe(true);
      expect(isDurableUserWorkQueue(name)).toBe(false);
    }
  });

  it("canonicalises known aliases", () => {
    expect(classifyQueue("error-reports")?.queue).toBe("diagnostics-telemetry");
    expect(classifyQueue("ticket")?.queue).toBe("tickets");
    expect(classifyQueue("histories")?.queue).toBe("history");
    expect(classifyQueue("fact")?.queue).toBe("facts");
    expect(classifyQueue("QA Captures")?.queue).toBe("qa-capture");
    expect(classifyQueue("visitor_journeys")?.queue).toBe("visitor-journey");
    expect(classifyQueue("builderforce.outbox.steps:chat-1")?.queue).toBe("steps");
    expect(classifyQueue("pending turns")?.queue).toBe("brain-turns");
  });

  it("maps each canonical user-work queue id to itself", () => {
    for (const queue of USER_WORK_QUEUES) {
      expect(classifyQueue(queue)?.queue).toBe(queue);
    }
  });

  it("retains activity and run-outcomes as durable user work", () => {
    // G13c (#5941): these two gained explicit rows. They resolved to durable before that
    // through the outbox's mode fallback; the row makes it a decision, and asserts it
    // through this table rather than through the mode.
    for (const name of ["activity", "run-outcomes"] as const) {
      const classified = classifyQueue(name);
      expect(classified?.queue).toBe(name);
      expect(classified?.retention).toBe("durable");
      expect(classified?.onFailure).toBe("retain-until-acked");
      expect(classified?.kind).toBe("user-work");
      expect(isDurableUserWorkQueue(name)).toBe(true);
      expect(isTelemetryQueue(name)).toBe(false);
    }
  });

  it("does not guess a name this table does not own", () => {
    // `host-persist` stays here deliberately — one queue mixes chat messages with host
    // telemetry, so no single retention is right for part of its payload on every
    // delivery. Only that one name; `activity` and `run-outcomes` now have rows.
    for (const name of ["host-persist", "", "   ", undefined, null]) {
      expect(classifyQueue(name)).toBeUndefined();
      expect(isDurableUserWorkQueue(name)).toBe(false);
      expect(isTelemetryQueue(name)).toBe(false);
    }
  });

  it("pairs retention with exactly one failure policy", () => {
    for (const name of [...USER_WORK_QUEUES, "history", "telemetry", "qa-capture"]) {
      const classified = classifyQueue(name);
      expect(classified).toBeDefined();
      if (classified?.retention === "durable") {
        expect(classified.onFailure).toBe("retain-until-acked");
        expect(classified.kind).toBe("user-work");
      } else {
        expect(classified?.onFailure).toBe("drop-on-failure");
        expect(classified?.kind).toBe("telemetry");
      }
    }
  });
});
