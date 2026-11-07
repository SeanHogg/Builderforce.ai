import { beforeEach, describe, expect, it, vi } from "vitest";
import { runFileName, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";
import type { ChunkFingerprint, IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { extractorManifestKey, type ReviewReport } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeEvent, KnowledgeStoredRun } from "./knowledgeProtocol";

const root = { rootId: "ws", rootPath: "/ws", folderPath: "/ws", rel: "", title: "ws" };

vi.mock("vscode", () => ({ l10n: { t: (m: string) => m }, window: {}, Uri: {} }));
vi.mock("../errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("./knowledgeFailureLog", () => ({ logReviewFailure: (_sink: unknown, _where: unknown, error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }) }));
// The replica host's process-wide "reviewing" count, as the real one keeps it.
const held = vi.hoisted(() => ({ reviewing: new Map<string, number>() }));
const hold = (id: string, by: number): void => { held.reviewing.set(id, Math.max(0, (held.reviewing.get(id) ?? 0) + by)); };
vi.mock("./knowledgeReplica", () => ({
  replicaStatusOf: vi.fn(async () => ({ queued: 2, sending: false, skipped: 0, skippedOps: [], failed: [] })),
  isRootReviewing: (id: string) => (held.reviewing.get(id) ?? 0) > 0,
  duringReview: async (id: string, _files: unknown, _pump: unknown, run: () => Promise<unknown>) => { hold(id, 1); try { return await run(); } finally { hold(id, -1); } },
}));
vi.mock("./knowledgeSyncStatus", () => ({ reviewRecords: new Map() }));
vi.mock("./knowledgeRoots", () => ({ rootById: (id: string) => (id === "ws" ? root : undefined), rootForPath: () => root }));
const reviewRootMock = vi.fn();
vi.mock("./knowledgeService", () => ({ log: vi.fn(), reviewRoot: (...args: unknown[]) => reviewRootMock(...args), workspaceFolders: () => [{ path: "/ws" }] }));

const { KnowledgeReviewSessions } = await import("./knowledgeReviewSessions");

const REPORT = { rootId: "ws", extracted: 1, judged: 0, extractErrors: 0, failures: [], aborted: false, durationMs: 5 } as unknown as ReviewReport;

function memoryFiles(): KnowledgeFiles & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: async (n) => data.get(n),
    write: async (n, t) => { data.set(n, t); },
    rename: async (from, to) => { data.set(to, data.get(from)!); data.delete(from); },
    remove: async (n) => { data.delete(n); },
    list: async (folder) => [...data.keys()].filter((k) => k.startsWith(`${folder}/`)).map((k) => k.slice(folder.length + 1)),
  };
}

function memoryManifest(): IngestManifest & { data: Map<string, ChunkFingerprint[]> } {
  const data = new Map<string, ChunkFingerprint[]>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); } };
}

/** A review whose run the test finishes by hand. */
function fakeReview() {
  const files = memoryFiles();
  const manifest = memoryManifest();
  const run = { finish: (_r: ReviewReport | Error) => undefined as void, opts: undefined as Record<string, unknown> | undefined };
  const review = {
    open: { root, files, manifest, pump: undefined },
    plan: vi.fn(async (force?: boolean) => ({ plan: { rootId: "ws", files: 1, byPack: {}, unchanged: 0, changed: [], removed: [], skipped: [], estimatedModelCalls: 0, force: !!force }, files: [] })),
    // Like the real one, a running review holds the root (knowledgeService's duringReview).
    run: vi.fn((opts: Record<string, unknown>) => {
      hold("ws", 1);
      return new Promise<ReviewReport>((resolve, reject) => {
        run.opts = opts;
        run.finish = (r) => (r instanceof Error ? reject(r) : resolve(r));
      }).finally(() => hold("ws", -1));
    }),
  };
  reviewRootMock.mockReturnValue(review);
  return { review, files, manifest, run };
}

function rig() {
  const posted: KnowledgeEvent[] = [];
  const sessions = new KnowledgeReviewSessions({} as never, (e) => posted.push(e), "test build");
  const planned = async (req: Parameters<typeof sessions.planOver>[0], stream = "s1") => {
    sessions.planOver(req, stream);
    await vi.waitFor(() => expect(posted.some((e) => e.stream === stream && (e.type === "planned" || e.type === "failed"))).toBe(true));
    return posted.filter((e) => e.stream === stream).at(-1)!;
  };
  const runsOf = (stream: string) => posted.flatMap((e) => (e.stream === stream && e.type === "run" ? [e.run] : []));
  return { sessions, posted, planned, runsOf };
}

const reviewIdOf = (event: KnowledgeEvent): string => {
  if (event.type !== "planned" || !("reviewId" in event.reply)) throw new Error("not planned");
  return event.reply.reviewId;
};

beforeEach(() => { reviewRootMock.mockReset(); held.reviewing.clear(); });

describe("a review as a run (sessions wiring)", () => {
  it("records the run: posts it on the review's stream, folds progress and steps, keeps it, then reports done", async () => {
    const { review, files, run } = fakeReview();
    const { sessions, posted, planned, runsOf } = rig();
    const id = reviewIdOf(await planned({ rootId: "ws", force: true }));
    expect(sessions.start(id)).toBe(true);

    const opts = run.opts as { onProgress(p: unknown): void; onStep(s: unknown): void };
    expect(review.run).toHaveBeenCalledTimes(1);
    opts.onProgress({ phase: "extract", done: 0, total: 3, path: "a.ts" });
    opts.onStep({ path: "a.ts", phase: "extract", ms: 4, outcome: "failed", reason: "boom", lane: 0 });
    run.finish(REPORT);
    await vi.waitFor(() => expect(posted.some((e) => e.type === "done")).toBe(true));

    // The progress event the card needs still flows; the run record rides beside it.
    expect(posted.some((e) => e.stream === id && e.type === "progress")).toBe(true);
    const records = runsOf(id);
    expect(records[0]).toMatchObject({ kind: "re-review", root: "ws" });
    const final = records.at(-1)!;
    expect(final).toMatchObject({ outcome: "done", failureCount: 1 });
    // The run was kept before the final record and the done event went out.
    const kept = JSON.parse(files.data.get(runFileName(final.id))!) as KnowledgeStoredRun;
    expect(kept).toMatchObject({ outcome: "done", failures: [{ path: "a.ts", reason: "boom" }] });
    expect(posted.findIndex((e) => e.type === "done")).toBeGreaterThan(posted.findIndex((e) => e.type === "run" && e.run.outcome === "done"));
  });

  it("names a seed run, and records an aborted review as stopped", async () => {
    const { run } = fakeReview();
    const { sessions, posted, planned, runsOf } = rig();
    const id = reviewIdOf(await planned({ rootId: "ws", seed: true }));
    sessions.start(id);
    run.finish({ ...REPORT, aborted: true });
    await vi.waitFor(() => expect(posted.some((e) => e.type === "done")).toBe(true));
    expect(runsOf(id)[0]).toMatchObject({ kind: "seed" });
    expect(runsOf(id).at(-1)).toMatchObject({ outcome: "stopped" });
  });

  it("records a review that throws as failed (stopped when it was aborted), and reports the failure", async () => {
    const { run } = fakeReview();
    const { sessions, posted, planned, runsOf } = rig();
    const id = reviewIdOf(await planned({ rootId: "ws" }));
    sessions.start(id);
    run.finish(new Error("store write failed"));
    await vi.waitFor(() => expect(posted.some((e) => e.type === "failed" && e.error === "store write failed")).toBe(true));
    expect(runsOf(id).at(-1)).toMatchObject({ outcome: "failed" });
  });

  it("stop and stopRun abort the running review's signal", async () => {
    const { run } = fakeReview();
    const { sessions, planned, runsOf } = rig();
    const id = reviewIdOf(await planned({ rootId: "ws" }));
    sessions.start(id);
    const signal = (run.opts as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);
    sessions.stopRun("someone-else");
    expect(signal.aborted).toBe(false);
    sessions.stopRun(runsOf(id)[0]!.id);
    expect(signal.aborted).toBe(true);

    const second = fakeReview();
    const again = reviewIdOf(await planned({ rootId: "ws" }, "s2"));
    sessions.start(again);
    sessions.stop(again);
    expect((second.run.opts as { signal: AbortSignal }).signal.aborted).toBe(true);
    // End both runs so their record timers stop.
    run.finish({ ...REPORT, aborted: true });
    second.run.finish({ ...REPORT, aborted: true });
  });
});

describe("Retry (a normal review request that owes the failed files a review)", () => {
  it("marks the files owed, then plans for the confirm as any review does", async () => {
    const { review, manifest } = fakeReview();
    const { planned } = rig();
    const event = await planned({ rootId: "ws", retry: ["src/bad.ts", "src/slow.ts"] });

    expect(event.type).toBe("planned");
    expect(manifest.data.get(extractorManifestKey("ws"))!.map((f) => f.id)).toEqual(["owed:src/bad.ts", "owed:src/slow.ts"]);
    expect(review.plan).toHaveBeenCalledTimes(1);
    // The estimate is the planner's: nothing was started without the confirm.
    expect(review.run).not.toHaveBeenCalled();
  });

  it("keeps the seed flag of a seed run, and a forced re-review's force", async () => {
    fakeReview();
    const { planned } = rig();
    await planned({ rootId: "ws", retry: ["a.ts"], seed: true });
    expect(reviewRootMock.mock.calls.at(-1)![1]).toEqual(root);
    expect(reviewRootMock.mock.calls.at(-1)![2]).toEqual({ seed: true });
  });

  it("is refused while a review of the root is running: nothing is marked, nothing planned", async () => {
    const { review, manifest, run } = fakeReview();
    const { sessions, planned } = rig();
    const running = reviewIdOf(await planned({ rootId: "ws" }));
    sessions.start(running);
    review.plan.mockClear();

    const refused = await planned({ rootId: "ws", retry: ["src/bad.ts"] }, "s2");
    expect(refused).toMatchObject({ type: "failed", error: "A review of this folder is already running." });
    expect(manifest.data.has(extractorManifestKey("ws"))).toBe(false);
    expect(review.plan).not.toHaveBeenCalled();
    run.finish(REPORT);
  });

  it("is allowed again once the running review has ended", async () => {
    const { run, manifest } = fakeReview();
    const { sessions, posted, planned } = rig();
    const running = reviewIdOf(await planned({ rootId: "ws" }));
    sessions.start(running);
    run.finish(REPORT);
    await vi.waitFor(() => expect(posted.some((e) => e.type === "done")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0)); // the session is dropped just after `done`

    const event = await planned({ rootId: "ws", retry: ["src/bad.ts"] }, "s3");
    expect(event.type).toBe("planned");
    expect(manifest.data.get(extractorManifestKey("ws"))!.map((f) => f.id)).toContain("owed:src/bad.ts");
  });

  it("is refused while ANY review of the root holds it (a pre-fetch, a pack review, a closed panel), not only this panel's", async () => {
    const { review, manifest } = fakeReview();
    const { planned } = rig();
    hold("ws", 1); // a review started outside this panel's sessions
    const refused = await planned({ rootId: "ws", retry: ["src/bad.ts"] });
    expect(refused).toMatchObject({ type: "failed", error: "A review of this folder is already running." });
    expect(manifest.data.has(extractorManifestKey("ws"))).toBe(false);
    expect(review.plan).not.toHaveBeenCalled();
  });

  it("holds the root while it marks the files owed and plans, and releases it after", async () => {
    const { review, manifest } = fakeReview();
    const heldDuring: boolean[] = [];
    const get = manifest.get;
    manifest.get = async (k) => { heldDuring.push((held.reviewing.get("ws") ?? 0) > 0); return get(k); };
    review.plan.mockImplementationOnce(async (force?: boolean) => {
      heldDuring.push((held.reviewing.get("ws") ?? 0) > 0);
      return { plan: { rootId: "ws", files: 1, byPack: {}, unchanged: 0, changed: [], removed: [], skipped: [], estimatedModelCalls: 0, force: !!force }, files: [] };
    });
    const { planned } = rig();
    expect((await planned({ rootId: "ws", retry: ["src/bad.ts"] })).type).toBe("planned");
    expect(heldDuring).toEqual([true, true]);
    expect(held.reviewing.get("ws") ?? 0).toBe(0);
  });
});

describe("stopRun is process-wide", () => {
  it("stops a run that another (or a closed) panel's sessions started", async () => {
    const { run } = fakeReview();
    const first = rig();
    const id = reviewIdOf(await first.planned({ rootId: "ws" }));
    first.sessions.start(id);
    const signal = (run.opts as { signal: AbortSignal }).signal;
    const runId = first.runsOf(id)[0]!.id;
    first.sessions.dispose(); // its panel closed; the review keeps running
    rig().sessions.stopRun(runId);
    expect(signal.aborted).toBe(true);
    run.finish({ ...REPORT, aborted: true });
  });
});
