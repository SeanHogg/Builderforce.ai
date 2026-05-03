import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { buildGraphs } from "../src/build-graphs";
import { decodeModel } from "../src/onnx/decode";

describe("buildGraphs CLI helper", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "webdit-bg-"));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it("writes three .onnx files for mini-test", async () => {
    const result = await buildGraphs({ architecture: "mini-test", output: dir, seed: 1 });
    for (const p of [result.files.dit, result.files.textEncoder, result.files.vae]) {
      const stat = await fs.stat(p);
      expect(stat.size).toBeGreaterThan(0);
    }
    expect(result.bytesWritten).toBeGreaterThan(0);
  });

  it("produced graphs decode back to expected ops", async () => {
    const result = await buildGraphs({ architecture: "mini-test", output: dir, seed: 0 });
    const dit = decodeModel(await fs.readFile(result.files.dit));
    const te = decodeModel(await fs.readFile(result.files.textEncoder));
    const vae = decodeModel(await fs.readFile(result.files.vae));
    expect(dit.graph.nodes.map((n) => n.opType)).toEqual(["Mul", "Add"]);
    expect(te.graph.nodes.map((n) => n.opType)).toEqual(["Gather"]);
    expect(vae.graph.nodes.map((n) => n.opType)).toEqual(["Conv", "Resize", "Tanh"]);
  });

  it("is deterministic for a given seed", async () => {
    const a = await buildGraphs({ architecture: "mini-test", output: path.join(dir, "a"), seed: 7 });
    const b = await buildGraphs({ architecture: "mini-test", output: path.join(dir, "b"), seed: 7 });
    const aDit = await fs.readFile(a.files.dit);
    const bDit = await fs.readFile(b.files.dit);
    expect(Array.from(aDit)).toEqual(Array.from(bDit));
  });

  it("rejects architectures that require upstream PyTorch ONNX export", async () => {
    await expect(
      buildGraphs({ architecture: "ltx2-distilled", output: dir }),
    ).rejects.toThrow(/upstream ONNX export/);
  });
});
