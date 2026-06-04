/**
 * Mamba State Engine — pure JavaScript SSM recurrence for Node.js.
 *
 * Implements the discrete-time SSM step:
 *   h_{t+1} = A_disc · h_t + B_disc · x_t
 *   y_t     = C · h_t + D · x_t
 *
 * This is the "v2 JS SSM recurrence" path described in custom-agentNodes-llm.md §4.6.
 * No WebGPU required — runs entirely on the CPU via plain Float32 arithmetic.
 *
 * State is persisted to .builderforce/memory/mamba-state.json and loaded on startup.
 * The snapshot is also synced back to Builderforce via PUT /api/agents/:id/mamba-state.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveBuilderForceAgentsDir } from "../builderforce/project-context.js";
import type { MambaStateSnapshot } from "../builderforce/types.js";
import { readSharedEnvVar } from "../infra/env-file.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

const log = createSubsystemLogger("mamba-state");

const MAMBA_STATE_FILE = "mamba-state.json";
const SYNC_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// SSM recurrence
// ---------------------------------------------------------------------------

/**
 * Advance the Mamba SSM by one input embedding step.
 *
 * The input embedding is mapped into the SSM channel space via a simple
 * linear projection (element-wise with wrapping) then the standard
 * first-order linear recurrence is applied per channel per order:
 *
 *   h[c][o] = A * h[c][o] + B * x_proj[c]
 *   y[c]    = C * h[c][0] + D * x_proj[c]
 *
 * A, B, C, D are derived deterministically from the state snapshot's
 * dim/order/channels so no separate weight file is required. This matches
 * the "v1 context injection" fidelity level — the state captures interaction
 * trajectory, not full model weights.
 */
export function jsSelectiveScan(params: {
  state: MambaStateSnapshot;
  inputEmbedding: Float32Array;
}): { nextState: MambaStateSnapshot; output: Float32Array } {
  const { state, inputEmbedding } = params;
  const { dim, order, channels, step } = state;
  const stateData = new Float32Array(state.data);

  // Simple deterministic SSM parameters (no learned weights needed for context injection)
  const A = -0.1; // decay factor: 0 < |A| < 1 keeps the recurrence stable
  const B = 0.5; // input gain
  const C = 1.0; // output projection
  const D = 0.1; // skip connection

  // Project input into channel space (wrap around if dim > channels)
  const xProj = new Float32Array(channels);
  for (let c = 0; c < channels; c++) {
    xProj[c] = inputEmbedding[c % inputEmbedding.length] ?? 0;
  }

  // h layout: [channel * order + order_idx] with stride = order
  const nextData = new Float32Array(stateData);
  const output = new Float32Array(channels);

  for (let c = 0; c < channels; c++) {
    const base = c * order;
    for (let o = 0; o < order; o++) {
      nextData[base + o] = A * stateData[base + o] + B * xProj[c];
    }
    output[c] = C * nextData[base] + D * xProj[c];
  }

  const nextState: MambaStateSnapshot = {
    data: Array.from(nextData),
    dim,
    order,
    channels,
    step: step + 1,
  };

  return { nextState, output };
}

// ---------------------------------------------------------------------------
// Context string — "v1 format" injected into system prompt
// ---------------------------------------------------------------------------

/**
 * Derive a compact memory context string from a Mamba state snapshot.
 * This is injected as `[Memory: step=N signal=X context="..."]` in the
 * system prompt, giving the model a lightweight signal about prior interactions.
 */
export function mambaStateToContextLine(state: MambaStateSnapshot): string {
  // Compute mean absolute signal from first 4 channel outputs as a summary scalar
  const preview = state.data.slice(0, Math.min(4, state.data.length));
  const signal =
    preview.length > 0
      ? (preview.reduce((s, v) => s + Math.abs(v), 0) / preview.length).toFixed(3)
      : "0.000";
  return `[Memory: step=${state.step} signal=${signal} context="persistent agent state"]`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load the Mamba state snapshot from .builderforce/memory/mamba-state.json.
 * Returns null when no state file exists yet.
 */
export async function loadMambaState(projectRoot: string): Promise<MambaStateSnapshot | null> {
  const filePath = path.join(resolveBuilderForceAgentsDir(projectRoot).memoryDir, MAMBA_STATE_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const snap = JSON.parse(raw) as MambaStateSnapshot;
    if (!snap.data || !snap.dim || !snap.step) {
      log.warn("mamba-state.json is malformed, ignoring");
      return null;
    }
    log.debug(`Loaded mamba state: step=${snap.step} channels=${snap.channels}`);
    return snap;
  } catch {
    return null;
  }
}

/**
 * Persist the Mamba state snapshot to .builderforce/memory/mamba-state.json.
 */
export async function saveMambaState(
  projectRoot: string,
  state: MambaStateSnapshot,
): Promise<void> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  await fs.mkdir(dir.memoryDir, { recursive: true });
  const filePath = path.join(dir.memoryDir, MAMBA_STATE_FILE);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
  log.debug(`Saved mamba state: step=${state.step}`);
}

// ---------------------------------------------------------------------------
// Remote sync
// ---------------------------------------------------------------------------

/**
 * Push the updated Mamba state to Builderforce via PUT /api/agents/:id/mamba-state.
 * Fails silently — state persistence is best-effort and must not block inference.
 */
export async function syncMambaStateToRegistry(params: {
  agentId: string;
  state: MambaStateSnapshot;
  registryUrl?: string;
}): Promise<void> {
  const apiKey = readSharedEnvVar("BUILDERFORCE_AGENTS_LINK_API_KEY");
  if (!apiKey) {
    log.debug("No BUILDERFORCE_AGENTS_LINK_API_KEY — skipping mamba state sync");
    return;
  }
  const base = normalizeBaseUrl(
    params.registryUrl ?? readSharedEnvVar("BUILDERFORCE_AGENTS_LINK_URL") ?? "https://api.builderforce.ai",
  );
  const url = `${base}/api/ide/agents/${encodeURIComponent(params.agentId)}/mamba-state`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(params.state),
      },
      SYNC_TIMEOUT_MS,
    );
    if (!res.ok) {
      log.warn(`Mamba state sync failed: ${res.status} ${res.statusText}`);
    } else {
      log.debug(`Mamba state synced: step=${params.state.step}`);
    }
  } catch (err) {
    log.warn(`Mamba state sync error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/**
 * Advance the Mamba state by encoding the user's message as a simple
 * character-frequency embedding (dim-length Float32Array).  Returns the
 * updated snapshot and the memory context line for the system prompt.
 */
export function advanceMambaState(params: { state: MambaStateSnapshot; userMessage: string }): {
  nextState: MambaStateSnapshot;
  memoryContext: string;
} {
  const { state, userMessage } = params;

  // Encode the message as a normalised character-frequency vector (dim-length)
  const embedding = new Float32Array(state.dim);
  for (let i = 0; i < userMessage.length; i++) {
    embedding[i % state.dim] += userMessage.charCodeAt(i) / 127;
  }
  // Normalise
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
  for (let i = 0; i < embedding.length; i++) {
    embedding[i] /= norm;
  }

  const { nextState } = jsSelectiveScan({ state, inputEmbedding: embedding });
  return { nextState, memoryContext: mambaStateToContextLine(nextState) };
}

/**
 * Build an initial zeroed Mamba state snapshot with standard dimensions.
 */
export function createInitialMambaState(params?: {
  dim?: number;
  order?: number;
  channels?: number;
}): MambaStateSnapshot {
  const dim = params?.dim ?? 64;
  const order = params?.order ?? 4;
  const channels = params?.channels ?? 16;
  return {
    data: Array.from<number>({ length: channels * order }).fill(0),
    dim,
    order,
    channels,
    step: 0,
  };
}
