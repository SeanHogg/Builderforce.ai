import { describe, expect, it } from "vitest";
import { exportDeadLetterAction, type DeadLetterRecord } from "./deadLetterExport.js";

function letter(overrides: Partial<DeadLetterRecord> & Pick<DeadLetterRecord, "id">): DeadLetterRecord {
  return { ...overrides };
}

describe("exportDeadLetterAction", () => {
  it("exports id, queue, reason, occurredAt, and a payload summary", () => {
    const result = exportDeadLetterAction([
      letter({
        id: "dl-1",
        queue: "ticket mutation",
        deadLetter: { reason: "HTTP 422", at: "2026-10-18T12:00:00.000Z" },
        payload: { taskId: 9, status: "done" },
      }),
    ]);
    expect(result.entries).toEqual([
      {
        id: "dl-1",
        queue: "ticket mutation",
        reason: "HTTP 422",
        occurredAt: "2026-10-18T12:00:00.000Z",
        payloadSummary: '{"taskId":9,"status":"done"}',
      },
    ]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("requeues only durable entries that still have a payload", () => {
    const result = exportDeadLetterAction([
      letter({ id: "ticket", queue: "ticket-mutation", item: { op: "archive" } }),
      letter({ id: "audit", queue: "audit close", payload: { runId: "a1" }, reason: "offline" }),
      letter({ id: "checkpoint", key: "run-checkpoint", item: { step: 3 }, occurredAt: "2026-10-18T00:00:00.000Z" }),
      letter({ id: "fact", queue: "fact_publish", payload: "digest" }),
    ]);
    expect(result.repair.requeue.map((row) => row.id)).toEqual(["ticket", "audit", "checkpoint", "fact"]);
    expect(result.repair.stayDead).toEqual([]);
    expect(result.repair.requeue.every((row) => row.action === "requeue" && row.retention === "durable" && row.why === undefined)).toBe(true);
    expect(result.entries[2]).toMatchObject({
      id: "checkpoint",
      queue: "run-checkpoint",
      occurredAt: "2026-10-18T00:00:00.000Z",
      payloadSummary: '{"step":3}',
    });
  });

  it("keeps best-effort letters dead even when a constructor stamped them durable", () => {
    const result = exportDeadLetterAction([
      letter({
        id: "err",
        queue: "error-reports",
        retention: "durable",
        payload: { message: "boom" },
        deadLetter: { reason: "HTTP 429", at: "2026-10-18T01:00:00.000Z" },
      }),
      letter({ id: "refresh", queue: "refresh sessions", item: { force: true }, retention: "durable" }),
    ]);
    expect(result.repair.requeue).toEqual([]);
    expect(result.repair.stayDead).toEqual([
      { id: "err", queue: "error-reports", retention: "best-effort", action: "stay-dead", why: "best-effort" },
      { id: "refresh", queue: "refresh sessions", retention: "best-effort", action: "stay-dead", why: "best-effort" },
    ]);
  });

  it("keeps a durable letter dead when the payload is missing", () => {
    const stripped: DeadLetterRecord = {
      id: "gone",
      queue: "audit-close",
      item: { runId: "should-not-win" },
      payload: null,
      reason: "store dropped body",
    };
    const absent = letter({ id: "empty", queue: "fact-publish", deadLetter: { reason: "no body" } });
    const result = exportDeadLetterAction([stripped, absent]);
    expect(result.repair.requeue).toEqual([]);
    expect(result.repair.stayDead.map((row) => row.why)).toEqual(["missing-payload", "missing-payload"]);
    expect(result.entries[0]?.payloadSummary).toBe("");
    expect(result.entries[1]?.reason).toBe("no body");
  });

  it("does not requeue an unclassified queue", () => {
    // `host-persist` is the live unclassified name: it mixes chat messages with host
    // telemetry, so no single retention fits. (`activity` and `run-outcomes` were used
    // here as the unclassified fixture until G13c/#5941 gave them durable rows.)
    const result = exportDeadLetterAction([
      letter({ id: "turns", queue: "brain-turns", item: { role: "user" }, retention: "durable" }),
      letter({ id: "host", key: "host-persist", payload: { kind: "heartbeat" } }),
    ]);
    expect(result.repair.requeue.map((row) => row.id)).toEqual(["turns"]);
    expect(result.repair.stayDead).toEqual([
      { id: "host", queue: "host-persist", retention: "unclassified", action: "stay-dead", why: "unclassified" },
    ]);
  });

  it("clips a long payload summary and does not mutate the input", () => {
    const payload = "x".repeat(400);
    const record = letter({ id: "long", queue: "ticket-mutation", payload, reason: "too big" });
    const before = JSON.stringify(record);
    const result = exportDeadLetterAction([record]);
    expect(result.entries[0]?.payloadSummary.endsWith("…")).toBe(true);
    expect(result.entries[0]?.payloadSummary.length).toBe(161);
    expect(JSON.stringify(record)).toBe(before);
    expect(result.repair.requeue).toHaveLength(1);
  });

  it("returns an empty plan for no letters", () => {
    expect(exportDeadLetterAction([])).toEqual({ entries: [], repair: { requeue: [], stayDead: [] } });
  });
});
