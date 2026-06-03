/**
 * System requirements checker for the BuilderForceAgentsLLM local brain.
 *
 * Before the first attempt to load the ONNX pipelines we verify:
 *   1. Enough free RAM to run inference in-process
 *   2. Enough free disk space to download the models (skipped if already cached)
 *
 * The check is cheap (no network calls) and is performed once per process;
 * the result is cached so it does not add latency to subsequent requests.
 *
 * Dual-model anatomy:
 *   Amygdala    — SmolLM2-1.7B-Instruct (q4):  ~0.9 GB disk, ~1.5 GB RAM
 *   Hippocampus — Qwen3-0.6B-ONNX (q4f16):    ~2.3 GB disk, ~0.6B params
 *   Total: ~3.2 GB download; 4 GB free disk recommended.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Free disk space needed to safely download both models (bytes). */
export const MIN_DISK_BYTES = 4 * 1024 ** 3; // 4 GB

/** Human-readable total disk needed for local brain (amygdala + hippocampus). Shown in README, wizard, and TUI loading panel. */
export const LOCAL_BRAIN_DISK_TOTAL_HINT = "~3.5 GB";

/** Free RAM needed to load the amygdala in-process (bytes).
 *  Hippocampus is loaded on demand; its RAM is checked separately. */
export const MIN_RAM_BYTES = 2 * 1024 ** 3; // 2 GB (amygdala only)

/** Additional free RAM needed to load the hippocampus model (bytes). */
export const HIPPOCAMPUS_MIN_RAM_BYTES = 2.5 * 1024 ** 3; // 2.5 GB

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LocalBrainCheckResult = {
  /** Whether the amygdala (fast router) can be loaded. */
  eligible: boolean;
  /** Whether the hippocampus (memory model) can be loaded. */
  hippocampusEligible: boolean;
  /**
   * Human-readable explanation when `eligible` is false.
   * Also logged at INFO level the first time the check runs.
   */
  reason?: string;
  /** Free RAM at check time (bytes). */
  freeRamBytes: number;
  /** Free disk space at check time (bytes); undefined when disk check was skipped. */
  freeDiskBytes?: number;
  /** True when amygdala model files are already present in cacheDir. */
  modelAlreadyCached: boolean;
  /** True when hippocampus model files are already present in cacheDir. */
  hippocampusModelCached: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a byte count as a human-readable string (KB / MB / GB). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Determine whether the HuggingFace cache directory already contains the
 * model files.  Uses the standard `models--<org>--<name>` slug used by
 * the transformers.js / huggingface hub cache layout.
 */
export async function isModelCached(cacheDir: string, modelId: string): Promise<boolean> {
  const slug = `models--${modelId.replace("/", "--")}`;
  try {
    const stat = await fs.stat(path.join(cacheDir, slug));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read free disk space for the given path using `fs.statfs`.
 * Returns `null` on platforms/Node versions that do not support `statfs`.
 */
async function getFreeDiskBytes(targetPath: string): Promise<number | null> {
  try {
    // Ensure the directory exists before calling statfs; fall back to parent.
    let checkPath = targetPath;
    try {
      await fs.mkdir(targetPath, { recursive: true });
    } catch {
      checkPath = path.dirname(targetPath);
    }
    const stats = await fs.statfs(checkPath);
    return stats.bsize * stats.bavail;
  } catch {
    // fs.statfs requires Node 18+; silently skip disk check on unsupported platforms.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

/**
 * Check whether the current system meets the minimum requirements to run
 * the local BuilderForceAgentsLLM brain models (amygdala + hippocampus).
 *
 * Safe to call concurrently — I/O is minimal (a stat + optional statfs).
 */
export async function checkLocalBrainRequirements(opts: {
  cacheDir: string;
  modelId: string;
  hippocampusModelId?: string;
}): Promise<LocalBrainCheckResult> {
  const freeRamBytes = os.freemem();

  // ── RAM check (amygdala — always required) ───────────────────────────────
  if (freeRamBytes < MIN_RAM_BYTES) {
    return {
      eligible: false,
      hippocampusEligible: false,
      reason:
        `Insufficient RAM for local brain: ${formatBytes(freeRamBytes)} free, ` +
        `${formatBytes(MIN_RAM_BYTES)} required. ` +
        `Routing to cortex (external LLM).`,
      freeRamBytes,
      modelAlreadyCached: false,
      hippocampusModelCached: false,
    };
  }

  // ── Model cache checks ───────────────────────────────────────────────────
  const modelAlreadyCached = await isModelCached(opts.cacheDir, opts.modelId);
  const hippocampusModelCached = opts.hippocampusModelId
    ? await isModelCached(opts.cacheDir, opts.hippocampusModelId)
    : false;

  // ── Hippocampus RAM eligibility (checked separately — it loads on demand)
  const hippocampusEligible = freeRamBytes >= MIN_RAM_BYTES + HIPPOCAMPUS_MIN_RAM_BYTES;

  if (modelAlreadyCached) {
    return {
      eligible: true,
      hippocampusEligible,
      freeRamBytes,
      modelAlreadyCached: true,
      hippocampusModelCached,
    };
  }

  // ── Disk space check (only when download is needed) ──────────────────────
  const freeDiskBytes = await getFreeDiskBytes(opts.cacheDir);

  if (freeDiskBytes !== null && freeDiskBytes < MIN_DISK_BYTES) {
    return {
      eligible: false,
      hippocampusEligible: false,
      reason:
        `Insufficient disk space to download local brain: ${formatBytes(freeDiskBytes)} free, ` +
        `${formatBytes(MIN_DISK_BYTES)} required. ` +
        `Routing to cortex (external LLM).`,
      freeRamBytes,
      freeDiskBytes,
      modelAlreadyCached: false,
      hippocampusModelCached,
    };
  }

  return {
    eligible: true,
    hippocampusEligible,
    freeRamBytes,
    freeDiskBytes: freeDiskBytes ?? undefined,
    modelAlreadyCached: false,
    hippocampusModelCached,
  };
}
