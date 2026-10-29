import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDIT_DEBOUNCE_MS, buildStoredGraph, planKnowledgeReviewDetail, reviewPacks, runKnowledgeReview, watchFileEdits, type KnowledgeReviewPorts,
} from "@builderforce/agent-tools/knowledge";
import type { JudgementPort } from "@seanhogg/builderforce-memory/knowledge";
import { createDirectorySource, type KnowledgeFs } from "./vscodeDirectorySource";
import { fileManifest, localKnowledgeStore, manifestFileName, type KnowledgeFiles } from "./knowledgeStores";

/**
 * PRD 38 §6 WS4/WS5 acceptance, end to end through the editor's host pieces: a fixture folder
 * is reviewed through the shared runner (fake judge, the unlinked folder's local snapshot
 * store, the editor's DirectorySource), its graph is built from the store, and an edit to a
 * document marks its claims stale.
 */

const enc = new TextEncoder();
const ROOT = "/ws/specs";
const ROOT_ID = "ws/specs";

const FILES: Record<string, string> = {
  [`${ROOT}/lease.md`]: "# Lease\n\nThe lease ends on 1 June.\n\n## Termination\n\nEither party may terminate with 30 days notice.\n",
  [`${ROOT}/policy.md`]: "# Policy\n\nRent is paid monthly.\n",
  [`${ROOT}/src/rent.ts`]: "export function rentDue(): number { return 1; }\n",
};

function fakeFs(files: Record<string, string>) {
  let watcher: ((paths: string[]) => void) | undefined;
  const fs: KnowledgeFs = {
    async readDirectory(dir) {
      const prefix = `${dir}/`;
      const out = new Map<string, "file" | "dir">();
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue;
        const [head, ...rest] = p.slice(prefix.length).split("/");
        out.set(head!, rest.length > 0 ? "dir" : "file");
      }
      return [...out];
    },
    async stat(path) {
      return { mtime: 1, size: enc.encode(files[path] ?? "").length };
    },
    async readFile(path) {
      const text = files[path];
      if (text === undefined) throw new Error("gone");
      return enc.encode(text);
    },
    watch(_base, cb) {
      watcher = cb;
      return () => { watcher = undefined; };
    },
  };
  return { fs, emit: (paths: string[]) => watcher?.(paths) };
}

function memoryFiles(): KnowledgeFiles {
  const data = new Map<string, string>();
  return { read: async (n) => data.get(n), write: async (n, t) => { data.set(n, t); } };
}

/** One claim per section, quoted from it. */
const judgement: JudgementPort = {
  async judge(req) {
    return {
      extract: req.items.map((i) => ({ ref: i.ref, claims: [{ subject: "lease", predicate: "says", object: i.text.slice(0, 12), quote: i.text.slice(0, 20) }], entities: [] })),
      invalid: 0,
    };
  },
};

async function review() {
  const disk = { ...FILES };
  const { fs, emit } = fakeFs(disk);
  const files = memoryFiles();
  const source = createDirectorySource({ fs, rootPath: ROOT, rootId: ROOT_ID, title: "specs" });
  const ports: KnowledgeReviewPorts = {
    source,
    store: localKnowledgeStore(files, ROOT_ID),
    manifest: fileManifest(files, manifestFileName(ROOT_ID)),
    judgement,
  };
  const detail = await planKnowledgeReviewDetail(ports);
  const report = await runKnowledgeReview(ports, { plan: detail });
  const graph = () => buildStoredGraph({ rootId: ROOT_ID, store: ports.store, manifest: ports.manifest, packs: reviewPacks({}) });
  return { ports, fs, disk, emit, source, detail, report, graph };
}

describe("a reviewed fixture folder in the editor's host", () => {
  it("loads as a graph of file, section and claim nodes", async () => {
    const { report, detail, graph } = await review();
    expect(detail.plan.files).toBe(3);
    expect(report.aborted).toBe(false);
    expect(report.judged).toBeGreaterThan(0);

    const g = (await graph())!;
    const kinds = new Set(g.nodes.map((n) => n.kind));
    expect([...kinds]).toEqual(expect.arrayContaining(["file", "section", "claim"]));
    expect(g.nodes.some((n) => n.ref === `src:${ROOT_ID}::lease.md`)).toBe(true);
    expect(g.nodes.some((n) => n.ref === `src:${ROOT_ID}::src/rent.ts`)).toBe(true);
    expect(g.nodes.some((n) => n.stale)).toBe(false);
  });

  afterEach(() => vi.useRealTimers());

  it("marks a document's claims stale when it is edited, on the editor's file watcher", async () => {
    const { ports, fs, disk, emit, source, graph } = await review();
    vi.useFakeTimers();
    const told: string[][] = [];
    let done!: () => void;
    const edited = new Promise<void>((resolve) => { done = resolve; });
    // As the editor runs it (`knowledgeLive`): the folder's watcher (`knowledgeFs`) has already settled
    // the burst the source reports, so `watchFileEdits` applies it without a second wait.
    const stop = watchFileEdits({
      rootId: ROOT_ID, rootPath: ROOT, fs, source, store: ports.store, manifest: ports.manifest, packs: reviewPacks({}),
      debounceMs: 0,
      onEdited: (paths) => { told.push(paths); done(); },
    });
    expect(stop).toBeTypeOf("function");

    disk[`${ROOT}/lease.md`] = `${FILES[`${ROOT}/lease.md`]}\nThe lease now ends on 1 July.\n`;
    emit([`${ROOT}/lease.md`]);
    expect(told).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    await edited; // the batch itself is promise work, no timers
    // The source reports root-relative paths of listed files.
    expect(told).toEqual([["lease.md"]]);

    vi.useRealTimers();
    const g = (await graph())!;
    const stale = g.nodes.filter((n) => n.stale);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.every((n) => n.kind === "claim")).toBe(true);
    stop!();
  });

  it("without a settled source, watchFileEdits itself settles a burst for its debounce, then applies it once", async () => {
    const { ports, fs, disk, emit, source } = await review();
    vi.useFakeTimers();
    const told: string[][] = [];
    let done!: () => void;
    const edited = new Promise<void>((resolve) => { done = resolve; });
    const stop = watchFileEdits({
      rootId: ROOT_ID, rootPath: ROOT, fs, source, store: ports.store, manifest: ports.manifest, packs: reviewPacks({}),
      onEdited: (paths) => { told.push(paths); done(); },
    });
    disk[`${ROOT}/lease.md`] = `${FILES[`${ROOT}/lease.md`]}\nedited\n`;
    emit([`${ROOT}/lease.md`]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS - 1);
    expect(told).toEqual([]);
    emit([`${ROOT}/lease.md`]); // another change inside the window restarts it
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS - 1);
    expect(told).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await edited;
    expect(told).toEqual([["lease.md"]]);
    stop!();
  });
});
