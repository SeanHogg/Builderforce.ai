import nodeFs from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeDeltaFrame, encodeJournalFrame, newLocalRecord, type LocalFirstSnapshot } from "@builderforce/local-first";
import { renameDurably } from "./localFirstAtomicFile";
import { copyCommittedTail } from "./localFirstCompaction";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-compaction-unit-"));
  directories.push(created);
  return created;
}

const MIB = 1024 * 1024;
const record = (id: string, size: number) => newLocalRecord({ id, entityType: "ticket", payload: { title: "x".repeat(size) }, deviceId: "device-1" });
const delta = (id: string, size = 0): Uint8Array => encodeDeltaFrame({ records: [record(id, size)] });
const emptySnapshot: LocalFirstSnapshot = { records: [], events: [], mappings: [], receipts: [], conflicts: [], cursors: {}, nextSequence: 1 };
const baseFrame = (): Uint8Array => encodeJournalFrame(emptySnapshot);
const join = (...parts: Uint8Array[]): Buffer => Buffer.concat(parts);

/** A journal of `prefix` + `tail` (+ `torn` bytes past the committed end) and a temp holding `tempFrame`. */
async function copyFrom(prefix: Uint8Array, tail: Buffer, options: { torn?: Uint8Array; from?: number; end?: number } = {}) {
  const root = await directory();
  const journal = nodePath.join(root, "journal");
  const tempPath = nodePath.join(root, "temp");
  const tempFrame = baseFrame();
  await writeFile(journal, join(prefix, tail, options.torn ?? new Uint8Array(0)));
  await writeFile(tempPath, tempFrame);
  const handle = await open(tempPath, "r+");
  try {
    const from = options.from ?? prefix.byteLength;
    const end = options.end ?? prefix.byteLength + tail.byteLength;
    const result = await copyCommittedTail(journal, from, end, handle, tempFrame.byteLength);
    return { result, temp: nodeFs.readFileSync(tempPath), tempFrame, tail };
  } finally {
    await handle.close();
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("copyCommittedTail", () => {
  it("copies a tail over 1 MiB, frames straddling the chunk boundary, byte for byte after the temp's own end", async () => {
    const frames = Array.from({ length: 200 }, (_, index) => delta(`row-${index}`, 10_000));
    const tail = join(...frames);
    expect(tail.byteLength).toBeGreaterThan(MIB);
    const { result, temp, tempFrame } = await copyFrom(baseFrame(), tail);
    expect(result).toEqual({ frames: 200, bytes: tail.byteLength });
    expect(temp.equals(join(tempFrame, tail))).toBe(true);
  });

  it("copies a frame larger than a chunk", async () => {
    const tail = join(delta("small-1", 10), delta("huge", 2.5 * MIB), delta("small-2", 10));
    const { result, temp, tempFrame } = await copyFrom(baseFrame(), tail);
    expect(result.frames).toBe(3);
    expect(temp.equals(join(tempFrame, tail))).toBe(true);
  });

  it("never copies a torn uncommitted tail past the committed end", async () => {
    const tail = join(delta("one"), delta("two"), delta("three"));
    const torn = delta("torn", 500).subarray(0, 200);
    const { result, temp, tempFrame } = await copyFrom(baseFrame(), tail, { torn });
    expect(result).toEqual({ frames: 3, bytes: tail.byteLength });
    expect(temp.equals(join(tempFrame, tail))).toBe(true);
  });

  it("copies nothing for an empty range", async () => {
    const { result, temp, tempFrame } = await copyFrom(baseFrame(), Buffer.alloc(0));
    expect(result).toEqual({ frames: 0, bytes: 0 });
    expect(temp.equals(Buffer.from(tempFrame))).toBe(true);
  });

  it("throws on a base frame in the range", async () => {
    await expect(copyFrom(baseFrame(), join(delta("one"), baseFrame(), delta("two")))).rejects.toThrow(/unexpected_frame/);
  });

  it("throws when the range ends inside a frame", async () => {
    const tail = join(delta("one"), delta("two"));
    await expect(copyFrom(baseFrame(), tail, { end: baseFrame().byteLength + tail.byteLength - 5 })).rejects.toThrow(/partial_frame/);
  });

  it("throws on a backwards range", async () => {
    const tail = join(delta("one"));
    const prefix = baseFrame();
    await expect(copyFrom(prefix, tail, { from: prefix.byteLength + tail.byteLength + 10, end: prefix.byteLength + tail.byteLength })).rejects.toThrow(/backwards/);
  });
});

describe("renameDurably", () => {
  it("retries a transient sharing error and then renames, syncing the directory", async () => {
    const root = await directory();
    const from = nodePath.join(root, "from");
    const to = nodePath.join(root, "to");
    await writeFile(from, "data");
    const realRename = nodeFs.promises.rename.bind(nodeFs.promises);
    let failures = 2;
    const rename = vi.spyOn(nodeFs.promises, "rename").mockImplementation(async (a, b) => {
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error("EPERM: rename"), { code: "EPERM" });
      }
      return realRename(a, b);
    });
    await renameDurably(from, to);
    expect(rename).toHaveBeenCalledTimes(3);
    expect(nodeFs.readFileSync(to, "utf8")).toBe("data");
  });

  it("gives up after five tries and leaves the source in place", async () => {
    const root = await directory();
    const from = nodePath.join(root, "from");
    await writeFile(from, "data");
    const rename = vi.spyOn(nodeFs.promises, "rename").mockRejectedValue(Object.assign(new Error("EBUSY: rename"), { code: "EBUSY" }));
    await expect(renameDurably(from, nodePath.join(root, "to"))).rejects.toThrow(/EBUSY/);
    expect(rename).toHaveBeenCalledTimes(5);
    expect(nodeFs.existsSync(from)).toBe(true);
  });

  it("does not retry an error that is not a sharing violation", async () => {
    const root = await directory();
    const rename = vi.spyOn(nodeFs.promises, "rename").mockRejectedValue(Object.assign(new Error("ENOENT: rename"), { code: "ENOENT" }));
    await expect(renameDurably(nodePath.join(root, "a"), nodePath.join(root, "b"))).rejects.toThrow(/ENOENT/);
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
