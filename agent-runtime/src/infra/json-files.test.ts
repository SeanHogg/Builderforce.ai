import { afterEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  chmod: vi.fn(async () => undefined),
  rename: vi.fn(),
  copyFile: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: fsMocks,
  ...fsMocks,
}));

import { writeJsonAtomic } from "./json-files.js";

describe("writeJsonAtomic", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("falls back to copyFile when rename hits a Windows permission error", async () => {
    const err = new Error("EPERM") as NodeJS.ErrnoException;
    err.code = "EPERM";
    fsMocks.rename.mockRejectedValueOnce(err);

    await writeJsonAtomic("C:\\state\\devices\\pending.json", { ok: true });

    expect(fsMocks.copyFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(fsMocks.chmod).toHaveBeenCalled();
  });

  it("rethrows non-transient rename failures after cleanup", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    fsMocks.rename.mockRejectedValueOnce(err);

    await expect(writeJsonAtomic("C:\\state\\devices\\pending.json", { ok: true })).rejects.toBe(
      err,
    );

    expect(fsMocks.copyFile).not.toHaveBeenCalled();
    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
  });
});
