import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureExtractPool, disposeExtractPool, EXTRACT_WORKER_FILE, extractPoolDown, JUDGE_CONCURRENCY, reviewParallelism } from "./extractPoolHost";

const made: string[] = [];
function extensionWith(workerFile: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-pool-"));
  made.push(dir);
  fs.mkdirSync(path.join(dir, "out"));
  if (workerFile) fs.writeFileSync(path.join(dir, "out", EXTRACT_WORKER_FILE), "// worker");
  return dir;
}

afterEach(() => {
  disposeExtractPool();
  configureExtractPool("");
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("reviewParallelism", () => {
  it("uses the pool at its width, with the judge width, when there are cores to spare and the worker is shipped", () => {
    configureExtractPool(extensionWith(true), () => 4);
    const p = reviewParallelism();
    expect(p.extractPool).toBeTypeOf("function");
    expect(p.concurrency).toBe(4);
    expect(p.judgeConcurrency).toBe(JUDGE_CONCURRENCY);
    expect(p).not.toHaveProperty("maxModelCalls");
  });

  it("uses no pool and leaves the review's default width on a machine with one core to spare or fewer", () => {
    configureExtractPool(extensionWith(true), () => 1);
    const p = reviewParallelism();
    expect(p).toEqual({ judgeConcurrency: JUDGE_CONCURRENCY });
    expect(p).not.toHaveProperty("concurrency");
  });

  it("uses no pool when the worker file is missing or the extension path is unknown", () => {
    configureExtractPool(extensionWith(false), () => 4);
    expect(reviewParallelism()).toEqual({ judgeConcurrency: JUDGE_CONCURRENCY });
    configureExtractPool("", () => 4);
    expect(reviewParallelism()).toEqual({ judgeConcurrency: JUDGE_CONCURRENCY });
  });

  it("reports no pool trouble while nothing went wrong", () => {
    configureExtractPool(extensionWith(true), () => 2);
    reviewParallelism();
    expect(extractPoolDown()).toBeUndefined();
  });
});
