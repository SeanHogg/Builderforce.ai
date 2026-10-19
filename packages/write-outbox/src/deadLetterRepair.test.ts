import { describe, expect, it } from "vitest";
import {
  exportAndRequeueDeadLetter,
  exportDeadLettersForRepair,
  requeueDeadLetter,
  type DeadLetterRepairSource,
} from "./deadLetterRepair.js";

function letter(
  overrides: Partial<DeadLetterRepairSource> & Pick<DeadLetterRepairSource, "id">,
): DeadLetterRepairSource {
  return { ...overrides };
}

describe("exportDeadLettersForRepair", () => {
  it("returns the full payload, not a summary", () => {
    const payload = { taskId: 9, status: "done", note: "x".repeat(400) };
    const exported = exportDeadLettersForRepair([
      letter({
        id: "dl-1",
        queue: "ticket mutation",
        deadLetter: { reason: "HTTP 422", at: "2026-10-18T12:00:00.000Z" },
        payload,
      }),
    ]);
    expect(exported).toEqual([
      {
        id: "dl-1",
        queue: "ticket mutation",
        reason: "HTTP 422",
        occurredAt: "2026-10-18T12:00:00.000Z",
        payload,
        hasPayload: true,
        retention: "durable",
        repairable: true,
      },
    ]);
    expect(exported[0]?.payload).toBe(payload);
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  });

  it("does not mutate the input", () => {
    const record = letter({ id: "fact", queue: "fact-publish", item: { digest: "v1" }, reason: "offline" });
    const before = JSON.stringify(record);
    exportDeadLettersForRepair([record]);
    expect(JSON.stringify(record)).toBe(before);
  });
});

describe("requeueDeadLetter", () => {
  it("requeues durable user work and uses a payload the person repaired", () => {
    const records = [
      letter({ id: "ticket", queue: "ticket-mutation", item: { op: "archive" } }),
      letter({ id: "audit", queue: "audit close", payload: { runId: "a1" }, reason: "offline" }),
    ];
    expect(requeueDeadLetter(records, "ticket")).toEqual({
      id: "ticket",
      queue: "ticket-mutation",
      retention: "durable",
      payload: { op: "archive" },
    });
    const repaired = { runId: "a1", closed: true };
    expect(requeueDeadLetter(records, "audit", { payload: repaired })).toEqual({
      id: "audit",
      queue: "audit close",
      retention: "durable",
      payload: repaired,
    });
    expect(JSON.stringify(records[1])).toBe(JSON.stringify(letter({ id: "audit", queue: "audit close", payload: { runId: "a1" }, reason: "offline" })));
  });

  it("keeps telemetry dead even when a constructor stamped it durable", () => {
    expect(
      requeueDeadLetter(
        [letter({ id: "err", item: { message: "boom" }, retention: "durable" })],
        "err",
        { queue: "error-reports", payload: { message: "edited" } },
      ),
    ).toBeNull();
    expect(
      requeueDeadLetter(
        [letter({ id: "noise", queue: "qa-capture", payload: { event: "click" }, retention: "durable" })],
        "noise",
      ),
    ).toBeNull();
    expect(requeueDeadLetter([letter({ id: "refresh", queue: "refresh sessions", item: { force: true } })], "refresh")).toBeNull();
  });

  it("keeps a durable letter dead when the payload is missing or stripped", () => {
    const records = [
      letter({ id: "gone", queue: "audit-close", item: { runId: "should-not-win" }, payload: null }),
      letter({ id: "empty", queue: "fact-publish" }),
    ];
    expect(requeueDeadLetter(records, "gone")).toBeNull();
    expect(requeueDeadLetter(records, "empty")).toBeNull();
    expect(
      requeueDeadLetter([letter({ id: "audit", queue: "audit-close", payload: { runId: "a1" } })], "audit", {
        payload: null,
      }),
    ).toBeNull();
    expect(exportDeadLettersForRepair(records).map((row) => row.whyNot)).toEqual([
      "missing-payload",
      "missing-payload",
    ]);
  });

  it("does not requeue an unclassified queue, a blank id, or an unknown id", () => {
    // `host-persist` is the live unclassified name (`activity` and `run-outcomes` held this
    // role until G13c/#5941 gave them durable rows).
    const records = [letter({ id: "host", key: "host-persist", payload: { kind: "heartbeat" } })];
    expect(requeueDeadLetter(records, "host")).toBeNull();
    expect(requeueDeadLetter(records, "  ")).toBeNull();
    expect(requeueDeadLetter(records, "missing")).toBeNull();
    expect(exportDeadLettersForRepair(records)[0]).toMatchObject({
      retention: "unclassified",
      repairable: false,
      whyNot: "unclassified",
    });
  });

  it("requeues an unknown queue only when it is explicitly durable", () => {
    const stamped = [letter({ id: "host", queue: "host-persist", item: { kind: "chat" }, retention: "durable" })];
    expect(requeueDeadLetter(stamped, "host")).toEqual({
      id: "host",
      queue: "host-persist",
      retention: "durable",
      payload: { kind: "chat" },
    });
  });

  it("requeues activity and run outcomes without a retention stamp, because both are now user work", () => {
    // G13c/#5941: both gained explicit durable rows, so a letter for either is repairable
    // with no stamp — the same rule `brain-turns` has always had.
    expect(requeueDeadLetter([letter({ id: "sig", queue: "activity", payload: { kind: "edit" } })], "sig")).toEqual({
      id: "sig",
      queue: "activity",
      retention: "durable",
      payload: { kind: "edit" },
    });
    expect(
      requeueDeadLetter([letter({ id: "outcomes", queue: "run-outcomes", payload: { taught: true } })], "outcomes"),
    ).toEqual({
      id: "outcomes",
      queue: "run-outcomes",
      retention: "durable",
      payload: { taught: true },
    });
  });

  it("requeues brain turns without a retention stamp because that queue is user work", () => {
    expect(requeueDeadLetter([letter({ id: "turn", queue: "brain-turns", item: { role: "user" } })], "turn")).toEqual({
      id: "turn",
      queue: "brain-turns",
      retention: "durable",
      payload: { role: "user" },
    });
  });
});

describe("exportAndRequeueDeadLetter", () => {
  it("exports every payload and requeues the named durable letter", () => {
    const records = [
      letter({ id: "fact", queue: "fact_publish", payload: "digest", deadLetter: { reason: "HTTP 409", at: "2026-10-18T00:00:00.000Z" } }),
      letter({ id: "err", queue: "client-report", payload: { message: "boom" }, retention: "durable" }),
    ];
    const before = JSON.stringify(records);
    const result = exportAndRequeueDeadLetter(records, "fact");
    expect(JSON.stringify(records)).toBe(before);
    expect(result.letters.map((row) => row.id)).toEqual(["fact", "err"]);
    expect(result.letters[0]).toMatchObject({
      payload: "digest",
      hasPayload: true,
      repairable: true,
      reason: "HTTP 409",
      occurredAt: "2026-10-18T00:00:00.000Z",
    });
    expect(result.letters[1]).toMatchObject({ repairable: false, whyNot: "best-effort", retention: "best-effort" });
    expect(result.requeued).toEqual({
      id: "fact",
      queue: "fact_publish",
      retention: "durable",
      payload: "digest",
    });
  });

  it("returns an empty export and no requeue when there are no letters", () => {
    expect(exportAndRequeueDeadLetter([], "any")).toEqual({ letters: [], requeued: null });
    expect(exportDeadLettersForRepair([])).toEqual([]);
  });
});
