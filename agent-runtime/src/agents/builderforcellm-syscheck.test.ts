import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  isModelCached,
  checkLocalBrainRequirements,
  MIN_DISK_BYTES,
  MIN_RAM_BYTES,
} from "./builderforcellm-syscheck.js";

// ── formatBytes ───────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("formats bytes below 1 MB as KB", () => {
    expect(formatBytes(512 * 1024)).toBe("512 KB");
  });

  it("formats bytes in the MB range", () => {
    expect(formatBytes(900 * 1024 ** 2)).toBe("900 MB");
  });

  it("formats bytes in the GB range", () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });

  it("formats 0 bytes as KB", () => {
    expect(formatBytes(0)).toBe("0 KB");
  });

  it("formats exactly 1 GB", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });
});

// ── isModelCached ─────────────────────────────────────────────────────────────

describe("isModelCached", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-syscheck-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("returns false when cache directory does not contain the model slug", async () => {
    const result = await isModelCached(tmpDir, "HuggingFaceTB/SmolLM2-1.7B-Instruct");
    expect(result).toBe(false);
  });

  it("returns true when the HuggingFace cache slug directory exists", async () => {
    // HuggingFace cache uses models--<org>--<name> slug
    const slug = "models--HuggingFaceTB--SmolLM2-1.7B-Instruct";
    await fs.mkdir(path.join(tmpDir, slug), { recursive: true });
    const result = await isModelCached(tmpDir, "HuggingFaceTB/SmolLM2-1.7B-Instruct");
    expect(result).toBe(true);
  });

  it("returns false when the slug path is a file, not a directory", async () => {
    const slug = "models--HuggingFaceTB--SmolLM2-1.7B-Instruct";
    await fs.writeFile(path.join(tmpDir, slug), "not a dir", "utf-8");
    const result = await isModelCached(tmpDir, "HuggingFaceTB/SmolLM2-1.7B-Instruct");
    expect(result).toBe(false);
  });

  it("builds the slug correctly for model IDs with a single slash", async () => {
    const slug = "models--my-org--my-model";
    await fs.mkdir(path.join(tmpDir, slug), { recursive: true });
    expect(await isModelCached(tmpDir, "my-org/my-model")).toBe(true);
    expect(await isModelCached(tmpDir, "other-org/my-model")).toBe(false);
  });
});

// ── checkLocalBrainRequirements ───────────────────────────────────────────────

/** Helper to create a minimal StatFs-shaped mock return value. */
function createMockStatFs(bavail: number) {
  return {
    bsize: 4096,
    bavail,
    type: 0,
    bfree: 0,
    blocks: 0,
    ffree: 0,
    files: 0,
    bavailNonRoot: 0,
  };
}

describe("checkLocalBrainRequirements", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-brain-check-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("returns ineligible when free RAM is below the minimum threshold", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(MIN_RAM_BYTES - 1);
    const result = await checkLocalBrainRequirements({
      cacheDir: tmpDir,
      modelId: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/insufficient ram/i);
    expect(result.freeRamBytes).toBe(MIN_RAM_BYTES - 1);
    vi.restoreAllMocks();
  });

  it("returns eligible when model is already cached (skips disk check)", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(MIN_RAM_BYTES + 1);
    // Create the cache slug so isModelCached returns true
    const slug = "models--HuggingFaceTB--SmolLM2-1.7B-Instruct";
    await fs.mkdir(path.join(tmpDir, slug), { recursive: true });

    const result = await checkLocalBrainRequirements({
      cacheDir: tmpDir,
      modelId: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    });
    expect(result.eligible).toBe(true);
    expect(result.modelAlreadyCached).toBe(true);
    expect(result.reason).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("includes modelAlreadyCached: true in the result when cached", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(MIN_RAM_BYTES * 2);
    const slug = "models--my-org--tiny-model";
    await fs.mkdir(path.join(tmpDir, slug), { recursive: true });

    const result = await checkLocalBrainRequirements({
      cacheDir: tmpDir,
      modelId: "my-org/tiny-model",
    });
    expect(result.modelAlreadyCached).toBe(true);
    vi.restoreAllMocks();
  });

  it("returns ineligible when disk is too low and model is not cached", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(MIN_RAM_BYTES * 2);
    vi.spyOn(fs, "statfs").mockResolvedValue(
      createMockStatFs(Math.floor((MIN_DISK_BYTES - 1) / 4096)),
    );

    const result = await checkLocalBrainRequirements({
      cacheDir: tmpDir,
      modelId: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/insufficient disk/i);
    expect(result.modelAlreadyCached).toBe(false);
    vi.restoreAllMocks();
  });

  it("returns eligible when RAM and disk are both sufficient and model not cached", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(MIN_RAM_BYTES * 2);
    vi.spyOn(fs, "statfs").mockResolvedValue(
      createMockStatFs(Math.ceil((MIN_DISK_BYTES + 1) / 4096)),
    );

    const result = await checkLocalBrainRequirements({
      cacheDir: tmpDir,
      modelId: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    });
    expect(result.eligible).toBe(true);
    expect(result.modelAlreadyCached).toBe(false);
    vi.restoreAllMocks();
  });

  it("returns eligible (skips disk check) when statfs is not supported", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(MIN_RAM_BYTES * 2);
    // Simulate Node.js version without statfs support
    vi.spyOn(fs, "statfs").mockRejectedValue(new Error("not supported"));

    const result = await checkLocalBrainRequirements({
      cacheDir: tmpDir,
      modelId: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    });
    expect(result.eligible).toBe(true);
    expect(result.freeDiskBytes).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("exports MIN_RAM_BYTES and MIN_DISK_BYTES with sensible values", () => {
    // RAM: at least 1 GB
    expect(MIN_RAM_BYTES).toBeGreaterThanOrEqual(1024 ** 3);
    // Disk: at least 1 GB
    expect(MIN_DISK_BYTES).toBeGreaterThanOrEqual(1024 ** 3);
  });
});
