import { describe, expect, it } from "vitest";
import type { RunDelta, RunDeltaCardPayload } from "@builderforce/run-delta";
import { droppedOverrides } from "./droppedOverrides";
import { createRunDeltaProgress, lastReplySince } from "./runDeltaProgress";
import { cardOf, redactDropped, type StoredRunDelta } from "./runDeltaRecords";

const computed = (runId: string, chatId = 7): RunDeltaCardPayload =>
  ({ chatId, runId, repo: "/repo", root: "/repo", delta: { runId } as unknown as RunDelta });

describe("the run delta card lifecycle (pending → computed | failed)", () => {
  it("posts the pending card at once, and nothing more when a computed card came", () => {
    const posted: RunDeltaCardPayload[] = [];
    const progress = createRunDeltaProgress((c) => posted.push(c));
    const done = progress.begin({ chatId: 7, runId: "r1", at: 42, repos: 1 });
    expect(posted).toEqual([{ chatId: 7, runId: "r1", at: 42, status: "pending" }]);
    progress.post(computed("r1"));
    done();
    expect(posted.map((c) => c.status ?? "computed")).toEqual(["pending", "computed"]);
  });

  it("replaces the pending card with `failed` when the computation ended without a delta (error or budget), once", () => {
    const posted: RunDeltaCardPayload[] = [];
    const progress = createRunDeltaProgress((c) => posted.push(c));
    const done = progress.begin({ chatId: 7, runId: "r1", repos: 2 });
    done();
    done();
    expect(posted).toEqual([{ chatId: 7, runId: "r1", status: "pending" }, { chatId: 7, runId: "r1", status: "failed" }]);
  });

  it("posts nothing for a run with no change set to measure", () => {
    const posted: RunDeltaCardPayload[] = [];
    const progress = createRunDeltaProgress((c) => posted.push(c));
    progress.begin({ chatId: 7, runId: "r1", repos: 0 })();
    expect(posted).toEqual([]);
  });

  it("answers run-delta/get with the pending card of a run still computing, and drops it once a card is stored", () => {
    const progress = createRunDeltaProgress(() => {});
    progress.begin({ chatId: 7, runId: "r1", at: 3, repos: 1 });
    progress.begin({ chatId: 8, runId: "r2", repos: 1 });
    expect(progress.withProgress({ runId: "r1" }, [])).toEqual([{ chatId: 7, runId: "r1", at: 3, status: "pending" }]);
    expect(progress.withProgress({ chatId: 7 }, []).map((c) => c.runId)).toEqual(["r1"]);
    expect(progress.withProgress({ chatId: 7 }, [computed("r1")])).toEqual([computed("r1")]);
    expect(progress.withProgress({}, [])).toEqual([]);
  });
});

describe("the card's anchor", () => {
  const msg = (id: number, role: string, createdAt: string) => ({ id, role, createdAt });

  it("is the last reply the run persisted", () => {
    const appended = [msg(1, "assistant", "2026-11-10T10:00:00Z"), msg(5, "assistant", "2026-11-10T10:05:00Z"), msg(6, "tool-step", "2026-11-10T10:06:00Z")];
    expect(lastReplySince(appended, "2026-11-10T10:04:00Z")).toBe(5);
  });

  it("is absent when the run wrote no reply (the newest predates it)", () => {
    expect(lastReplySince([msg(1, "assistant", "2026-11-10T10:00:00Z")], "2026-11-10T10:04:00Z")).toBeUndefined();
    expect(lastReplySince([], "2026-11-10T10:04:00Z")).toBeUndefined();
  });
});

describe("ignored overrides on the card", () => {
  it("keeps an unsafe pattern's reason code through redaction, and never a repo's own entry names", () => {
    const red = redactDropped(["invalid:guards.secretGuardName", "unsafe-regex:io.nested-quantifier", "unknown-key:guardz", "invalid:json", "unreadable:git-unavailable"]);
    expect(red).toContain("unsafe-regex:io.nested-quantifier");
    const overrides = droppedOverrides(red)!;
    expect(overrides.dropped).toEqual([
      { code: "invalid", section: "guards" },
      { code: "unsafe-regex", section: "io", reason: "nested-quantifier" },
      { code: "unknown-key", section: "guardz" },
      { code: "invalid-json", section: "" },
      { code: "unreadable", section: "", reason: "git-unavailable" },
    ]);
    expect(JSON.stringify(overrides)).not.toContain("secretGuardName");
  });

  it("reads older redacted forms and the truncation marker, and skips codes it does not know", () => {
    expect(droppedOverrides(["unsafe-regex:io#abcd1234", "invalid:root", "truncated:12", "mystery:x"])!.dropped).toEqual([
      { code: "unsafe-regex", section: "io" },
      { code: "invalid-root", section: "" },
      { code: "truncated", section: "", count: 12 },
    ]);
    expect(droppedOverrides(undefined)).toBeUndefined();
    expect(droppedOverrides([])).toBeUndefined();
  });

  it("puts the anchor and the overrides on a stored delta's card", () => {
    const stored = {
      value: { runId: "r1", repository: "x", changeSetId: "changeset:r1:k", chatId: 7, mode: "interactive", delta: {} as RunDelta, computedMs: 1, overridesDropped: ["unknown-key:nope"] },
      local: { kind: "local", runId: "r1", chatId: 7, root: "/repo", repo: "/repo", at: 42 },
    } as StoredRunDelta;
    expect(cardOf(stored)).toMatchObject({ at: 42, overrides: { dropped: [{ code: "unknown-key", section: "nope" }] } });
    expect(cardOf({ ...stored, value: { ...stored.value, overridesDropped: undefined }, local: { ...stored.local, at: undefined } }))
      .not.toHaveProperty("at");
  });
});
