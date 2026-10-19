import { describe, expect, it } from "vitest";
import {
  VSIX_SNAPSHOT_BUSY_TIMEOUT,
  VSIX_SNAPSHOT_REDACTION_NOTE,
  recoverCorruptSnapshot,
  secondWindowMayStealLock,
} from "./snapshotRecovery";

const SECRET = "sk-live-do-not-echo";
const TRUNCATED = `{"records":[{"id":"row","token":"${SECRET}"}],"events":`;

describe("VSIX corrupt snapshot recovery", () => {
  it("does not throw on a corrupt payload and does not echo a secret field", () => {
    expect(() => recoverCorruptSnapshot(TRUNCATED)).not.toThrow();
    const recovered = recoverCorruptSnapshot(TRUNCATED);
    expect(recovered.reason).toBe("corrupt_snapshot");
    expect(recovered.recovered).toEqual({ kind: "unavailable", reason: "corrupt_snapshot" });
    expect(recovered.redactionNote).toBe("Secrets are not written into the recovery copy.");
    expect(recovered.redactionNote).toBe(VSIX_SNAPSHOT_REDACTION_NOTE);
    expect(JSON.stringify(recovered)).not.toContain(SECRET);
    expect(JSON.stringify(recovered.recovered)).not.toContain("token");
  });

  it("does not throw when the payload is an object, null, or not JSON", () => {
    const cases: unknown[] = [
      null,
      undefined,
      30_000,
      { password: SECRET, records: "not-an-array" },
      "{not json",
      "",
    ];
    for (const payload of cases) {
      expect(() => recoverCorruptSnapshot(payload)).not.toThrow();
      expect(JSON.stringify(recoverCorruptSnapshot(payload))).not.toContain(SECRET);
    }
  });

  it("returns last-good bytes when provided, without the corrupt secret", () => {
    const lastGood = JSON.stringify({
      records: [{ id: "kept" }],
      events: [],
      mappings: [],
      receipts: [],
      conflicts: [],
      cursors: { dest: "cursor-9" },
      nextSequence: 4,
    });
    const recovered = recoverCorruptSnapshot(TRUNCATED, lastGood);
    expect(recovered.recovered).toEqual({ kind: "last-good", bytes: lastGood });
    if (recovered.recovered.kind !== "last-good") return;
    expect(recovered.recovered.bytes).not.toContain(SECRET);
    expect(recovered.recovered.bytes).toContain("kept");
    expect(JSON.stringify(recovered)).not.toContain(SECRET);
  });

  it("accepts last-good bytes as a Uint8Array and still drops a secret field", () => {
    const lastGood = JSON.stringify({ records: [{ id: "bytes" }], nextSequence: 2 });
    const recovered = recoverCorruptSnapshot(TRUNCATED, new TextEncoder().encode(lastGood));
    expect(recovered.recovered).toEqual({ kind: "last-good", bytes: lastGood });
    expect(JSON.stringify(recovered)).not.toContain(SECRET);
  });

  it("does not write a secret field from last-good into the recovery copy", () => {
    const lastGood = JSON.stringify({
      records: [{ id: "kept", token: SECRET, nested: { apiKey: "sk-nested-secret-value" } }],
      password: "plain-password-value",
    });
    const recovered = recoverCorruptSnapshot("{", lastGood);
    expect(recovered.recovered.kind).toBe("last-good");
    if (recovered.recovered.kind !== "last-good") return;
    expect(recovered.recovered.bytes).toContain("kept");
    expect(recovered.recovered.bytes).not.toContain(SECRET);
    expect(recovered.recovered.bytes).not.toContain("sk-nested-secret-value");
    expect(recovered.recovered.bytes).not.toContain("plain-password-value");
    expect(recovered.recovered.bytes).not.toMatch(/"token"/);
    expect(JSON.stringify(recovered)).not.toContain(SECRET);
  });

  it("does not substitute an empty store when last-good cannot be returned without the secret", () => {
    const recovered = recoverCorruptSnapshot(TRUNCATED, `prefix ${SECRET} suffix`);
    expect(recovered.recovered).toEqual({ kind: "unavailable", reason: "corrupt_snapshot" });
    expect(JSON.stringify(recovered)).not.toContain(SECRET);
  });

  it("keeps a record that appears twice", () => {
    const shared = { id: "shared" };
    const repeated = JSON.stringify({ records: [shared, shared], nextSequence: 3 });
    const recovered = recoverCorruptSnapshot("{", repeated);
    expect(recovered.recovered.kind).toBe("last-good");
    if (recovered.recovered.kind !== "last-good") return;
    expect(JSON.parse(recovered.recovered.bytes)).toEqual({
      records: [{ id: "shared" }, { id: "shared" }],
      nextSequence: 3,
    });
  });

  it("does not throw on a self-referencing payload or recurse forever", () => {
    const cyclic: Record<string, unknown> = { id: "cyclic", token: SECRET };
    cyclic.self = cyclic;
    const recovered = recoverCorruptSnapshot(cyclic, JSON.stringify({ records: [] }));
    expect(recovered.recovered.kind).toBe("last-good");
    if (recovered.recovered.kind !== "last-good") return;
    expect(JSON.stringify(recovered)).not.toContain(SECRET);
  });

  it("exports a busy timeout that is not a 30-second lock steal", () => {
    expect(VSIX_SNAPSHOT_BUSY_TIMEOUT).toBe("until_release");
    expect(VSIX_SNAPSHOT_BUSY_TIMEOUT).not.toBe(30_000);
    expect(String(VSIX_SNAPSHOT_BUSY_TIMEOUT)).not.toContain("30000");
    expect(secondWindowMayStealLock(30_000)).toBe(false);
    expect(secondWindowMayStealLock(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
