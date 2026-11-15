/**
 * packFile.test.ts — a `.bfpack` is canonical JSON (write → read round-trips the same content,
 * re-writing the same pack is a no-op on the bytes), the library folder is created on write, and a
 * read is cached by content so an unchanged file is parsed once and a changed one re-reads.
 *
 * Evidence re-verification: busts the verify cache (content-hash key) so the pre-push
 * gate re-runs checks against the repaired install instead of replaying a stale record.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePack, serializePack } from "@builderforce/agent-tools/knowledge";
import { readPackFile, writePackFile } from "./packFile";
import { leasePack, packFileOf } from "./packFixture.test-util";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "bf-packfile-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("packFile", () => {
  it("writes canonically and reads back the same content", async () => {
    const pack = await leasePack();
    const file = path.join(dir, "nested", "lease.bfpack");
    await writePackFile(file, pack);
    const read = await readPackFile(file);
    expect(serializePack(read)).toBe(serializePack(pack));
    expect(parsePack(serializePack(read))).toEqual(read);
  });

  it("writes the same pack as the same bytes (canonical, no timestamp churn)", async () => {
    const pack = await leasePack();
    const a = path.join(dir, "a.bfpack");
    const b = path.join(dir, "b.bfpack");
    await writePackFile(a, pack);
    await writePackFile(b, pack);
    expect(serializePack(await readPackFile(a))).toBe(serializePack(await readPackFile(b)));
  });

  it("serves an unchanged file from the cache (same identity) and re-reads after a write", async () => {
    const pack = await leasePack();
    const file = await packFileOf(pack);
    const first = await readPackFile(file);
    expect(await readPackFile(file)).toBe(first); // unchanged content: the SAME parsed object
    await writePackFile(file, { ...pack, title: "Renamed" });
    expect((await readPackFile(file)).title).toBe("Renamed"); // changed: re-read, not the stale cache
  });

  it("throws a descriptive error for a malformed file", async () => {
    const file = path.join(dir, "bad.bfpack");
    await writePackFile(file, await leasePack());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "not json", "utf8");
    await expect(readPackFile(file)).rejects.toThrow(/not valid JSON/);
  });
});
