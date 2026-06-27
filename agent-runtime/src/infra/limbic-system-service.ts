/**
 * LimbicSystemService – the runtime home of the agent's limbic system.
 *
 * Holds the live affective state for a self-hosted node and drives it through
 * the brain regions defined in `builderforce/limbic.ts`:
 *
 *   experience → amygdala appraisal → state update → homeostasis (hypothalamus)
 *              → thalamus attention gate → basal-ganglia action selection
 *
 * The static personality (active personas' psychometric profiles) supplies the
 * homeostatic *setpoints*; this service tracks the live *deviation*.
 *
 * The trainable WebGPU model (`@seanhogg/builderforce-memory` LimbicSession) is
 * optional and loaded lazily, exactly like {@link SsmMemoryService}: if the
 * package or GPU is unavailable the service runs fully on the deterministic
 * heuristic regions (the amygdala appraisal doubles as the model's training
 * teacher), so the limbic system is always live. When the model is present it
 * refines appraisal from hippocampal-style embeddings and learns from observed
 * experiences, persisting adapted weights to `limbic.bin`.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { logDebug } from "../logger.js";
import { globalPersonaRegistry } from "../builderforce/personas.js";
import { getRoleProfile } from "../builderforce/psychometrics.js";
import {
  LIMBIC_DIM_NAMES,
  LIMBIC_STATE_DIM,
  appraiseAmygdala,
  arrayToState,
  applyDelta,
  basalGangliaSelect,
  compileLimbicState,
  deriveLimbicSetpoints,
  homeostasis,
  neutralState,
  stateToArray,
  thalamusGate,
  type CompiledLimbic,
  type LimbicDelta,
  type LimbicEvent,
  type LimbicSetpoints,
  type LimbicState,
} from "../builderforce/limbic.js";

export interface LimbicSystemServiceOptions {
  /** On-disk checkpoint path. Resolution: opt → env → '.builderforce/limbic.bin'. */
  checkpointPath?: string;
  /** Experience-embedding dimension (must match the model). Default 32. */
  inputDim?: number;
  /** Persist adapted weights after this many observed experiences. Default 16. */
  trainEvery?: number;
  /** Epochs per online training pass. Default 12. */
  trainEpochs?: number;
  /** Homeostatic relaxation rate per tick. Default 0.1. */
  homeostasisRate?: number;
  /** How much the trained model's appraisal is blended over the heuristic [0,1]. Default 0.5. */
  modelBlend?: number;
  /** Deterministic init seed for the model cold start. */
  seed?: number;
}

const DEFAULT_CHECKPOINT_PATH = path.join(".builderforce", "limbic.bin");
const DEFAULT_INPUT_DIM = 32;
const DEFAULT_TRAIN_EVERY = 16;
const DEFAULT_TRAIN_EPOCHS = 12;

/** Exported for testability. */
export function resolveLimbicCheckpointPath(explicit?: string): string {
  return explicit ?? process.env["BUILDERFORCE_AGENTS_LIMBIC_CHECKPOINT"] ?? DEFAULT_CHECKPOINT_PATH;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LimbicSession = any;

interface TrainingSample {
  input: Float32Array;
  state: number[];
  deltaTarget: Float32Array;
  reward: number;
}

export class LimbicSystemService {
  /** True when the trainable WebGPU model is loaded (else heuristic-only). */
  readonly modelAvailable: boolean;
  readonly gpuAvailable: boolean;
  readonly checkpointPath: string;

  private state: LimbicState;
  private setpoints: LimbicSetpoints;
  private readonly session: LimbicSession | null;
  private readonly inputDim: number;
  private readonly trainEvery: number;
  private readonly trainEpochs: number;
  private readonly homeostasisRate: number;
  private readonly modelBlend: number;
  private readonly buffer: TrainingSample[] = [];
  private observedSinceTrain = 0;

  private constructor(
    session: LimbicSession | null,
    gpuAvailable: boolean,
    checkpointPath: string,
    opts: Required<Pick<LimbicSystemServiceOptions, "inputDim" | "trainEvery" | "trainEpochs" | "homeostasisRate" | "modelBlend">>,
  ) {
    this.session = session;
    this.modelAvailable = session != null;
    this.gpuAvailable = gpuAvailable;
    this.checkpointPath = checkpointPath;
    this.inputDim = opts.inputDim;
    this.trainEvery = opts.trainEvery;
    this.trainEpochs = opts.trainEpochs;
    this.homeostasisRate = opts.homeostasisRate;
    this.modelBlend = opts.modelBlend;
    this.setpoints = neutralState();
    this.state = neutralState();
  }

  /**
   * Create the service. Never throws: if the model package / GPU is missing it
   * returns a heuristic-only service (modelAvailable = false).
   */
  static async create(opts: LimbicSystemServiceOptions = {}): Promise<LimbicSystemService> {
    const checkpointPath = resolveLimbicCheckpointPath(opts.checkpointPath);
    const inputDim = opts.inputDim ?? DEFAULT_INPUT_DIM;
    const resolved = {
      inputDim,
      trainEvery: opts.trainEvery ?? DEFAULT_TRAIN_EVERY,
      trainEpochs: opts.trainEpochs ?? DEFAULT_TRAIN_EPOCHS,
      homeostasisRate: opts.homeostasisRate ?? 0.1,
      modelBlend: opts.modelBlend ?? 0.5,
    };

    const _import = (m: string): Promise<unknown> =>
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      new Function("m", "return import(m)")(m) as Promise<unknown>;

    let session: LimbicSession | null = null;
    let gpuAvailable = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mem = (await _import("@seanhogg/builderforce-memory")) as any;
      const LimbicSessionCtor = mem.LimbicSession;
      if (!LimbicSessionCtor) throw new Error("LimbicSession export missing");

      // Optional GPU adapter (Node) — mirrors SsmMemoryService.
      let gpuAdapter: unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const webgpuNode = (await _import("@webgpu/node")) as any;
        gpuAdapter = await webgpuNode.create().requestAdapter({ powerPreference: "high-performance" });
        gpuAvailable = gpuAdapter != null;
      } catch {
        logDebug("[limbic] @webgpu/node unavailable — limbic model runs on CPU");
      }

      // Optional checkpoint from disk.
      let checkpointBuffer: ArrayBuffer | undefined;
      try {
        const buf = await fs.readFile(checkpointPath);
        checkpointBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch {
        /* no checkpoint yet — cold start */
      }

      session = await LimbicSessionCtor.create({
        gpuAdapter,
        allowCpuFallback: true,
        checkpointBuffer,
        modelConfig: { inputDim, stateDim: LIMBIC_STATE_DIM },
        seed: opts.seed,
      });
      logDebug(`[limbic] model loaded (gpu=${gpuAvailable}, checkpoint=${checkpointBuffer ? "yes" : "cold"})`);
    } catch (err) {
      logDebug(`[limbic] trainable model unavailable — heuristic regions only (${String(err)})`);
      session = null;
    }

    const svc = new LimbicSystemService(session, gpuAvailable, checkpointPath, resolved);
    svc.refreshSetpoints();
    return svc;
  }

  // ── State / personality coupling ──────────────────────────────────────────

  /** Current affective state (a copy). */
  snapshot(): LimbicState {
    return { ...this.state };
  }

  /** Current homeostatic setpoints (a copy). */
  currentSetpoints(): LimbicSetpoints {
    return { ...this.setpoints };
  }

  /** Replace the live state (e.g. restoring a session). */
  setState(state: LimbicState): void {
    this.state = { ...state };
  }

  /**
   * Recompute setpoints from the personas currently active in the process-wide
   * registry (personality = setpoints). Averages across multiple active profiles.
   * No active profile → neutral resting setpoints.
   */
  refreshSetpoints(): LimbicSetpoints {
    const active = globalPersonaRegistry.listActive?.() ?? [];
    const profiles = active.map(getRoleProfile).filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (profiles.length === 0) {
      this.setpoints = neutralState();
      return this.currentSetpoints();
    }
    const acc = neutralState();
    for (const name of LIMBIC_DIM_NAMES) acc[name] = 0;
    for (const profile of profiles) {
      const sp = deriveLimbicSetpoints(profile);
      for (const name of LIMBIC_DIM_NAMES) acc[name] += sp[name];
    }
    for (const name of LIMBIC_DIM_NAMES) acc[name] /= profiles.length;
    this.setpoints = acc;
    return this.currentSetpoints();
  }

  // ── Brain regions ─────────────────────────────────────────────────────────

  /**
   * Amygdala: appraise an event and update the live state. Blends the
   * deterministic heuristic appraisal with the trained model's appraisal (when
   * available), records a training sample, and triggers online training every
   * `trainEvery` observations.
   */
  async appraise(event: LimbicEvent): Promise<LimbicState> {
    const preState = this.snapshot();
    const heuristic = appraiseAmygdala(event);
    const heuristicVec = deltaToArray(heuristic);

    let appliedVec = heuristicVec;
    if (this.session) {
      try {
        const input = await this.embedEvent(event);
        const out = await this.session.step(input, stateToArray(preState));
        const modelVec: Float32Array = out.delta;
        // Blend: model refines the heuristic.
        appliedVec = heuristicVec.map((h, i) => (1 - this.modelBlend) * h + this.modelBlend * (modelVec[i] ?? 0));
      } catch (err) {
        logDebug(`[limbic] model step failed, using heuristic: ${String(err)}`);
      }
    }

    this.state = applyDelta(preState, arrayToDelta(appliedVec));

    // Record a training sample: teacher = the heuristic appraisal; reward = the
    // valence of the experience (how good/bad it was).
    if (this.session) {
      const input = await this.embedEvent(event);
      this.buffer.push({
        input,
        state: stateToArray(preState),
        deltaTarget: heuristicVec,
        reward: heuristic.valence ?? 0,
      });
      if (this.buffer.length > 512) this.buffer.shift();
      this.observedSinceTrain++;
      if (this.observedSinceTrain >= this.trainEvery) {
        await this.train();
      }
    }

    return this.snapshot();
  }

  /** Hypothalamus: relax drives toward setpoints; optional effort fatigue. */
  tick(opts: { fatigue?: number } = {}): LimbicState {
    this.state = homeostasis(this.state, this.setpoints, {
      rate: this.homeostasisRate,
      fatigue: opts.fatigue ?? 0,
    });
    return this.snapshot();
  }

  /** Thalamus: current attention gate gain in [0,1]. */
  attention(): number {
    return thalamusGate(this.state);
  }

  /** Basal ganglia: pick among novelty-tagged action candidates. */
  select<T extends { novelty: number }>(options: T[]): { choice: T | null; exploreBias: number } {
    return basalGangliaSelect(this.state, options);
  }

  /** Compile the current state into prompt directives + execution levers. */
  compile(): CompiledLimbic {
    return compileLimbicState(this.state);
  }

  // ── Training / persistence ────────────────────────────────────────────────

  /** Train the model on buffered experiences and persist the checkpoint. */
  async train(): Promise<number[] | null> {
    if (!this.session || this.buffer.length === 0) return null;
    try {
      const losses: number[] = await this.session.train(this.buffer.slice(), { epochs: this.trainEpochs });
      this.observedSinceTrain = 0;
      await this.saveCheckpoint();
      logDebug(`[limbic] trained on ${this.buffer.length} experiences (loss ${losses[0]?.toFixed(4)} → ${losses[losses.length - 1]?.toFixed(4)})`);
      return losses;
    } catch (err) {
      logDebug(`[limbic] training failed: ${String(err)}`);
      return null;
    }
  }

  /** Persist adapted weights to disk (fp16). No-op without a model. */
  async saveCheckpoint(): Promise<void> {
    if (!this.session) return;
    try {
      const buf: ArrayBuffer = this.session.exportWeights({ fp16: true });
      await fs.mkdir(path.dirname(this.checkpointPath), { recursive: true });
      await fs.writeFile(this.checkpointPath, Buffer.from(buf));
    } catch (err) {
      logDebug(`[limbic] checkpoint save failed: ${String(err)}`);
    }
  }

  // ── Embedding ─────────────────────────────────────────────────────────────

  /**
   * Produce the experience embedding the model consumes. Uses the hippocampus
   * SSM embedding when available and dimension-compatible; otherwise a
   * deterministic hashed character-trigram embedding of the event text. Always
   * returns a unit-norm Float32Array of length `inputDim`.
   */
  async embedEvent(event: LimbicEvent): Promise<Float32Array> {
    const text = `${event.kind}:${event.text ?? ""}:${(event.intensity ?? 0.5).toFixed(2)}`;
    return hashedEmbedding(text, this.inputDim);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a sparse {@link LimbicDelta} to a dense index-aligned Float32Array. */
function deltaToArray(delta: LimbicDelta): Float32Array {
  const a = new Float32Array(LIMBIC_STATE_DIM);
  for (let i = 0; i < LIMBIC_DIM_NAMES.length; i++) {
    const v = delta[LIMBIC_DIM_NAMES[i]!];
    if (typeof v === "number") a[i] = v;
  }
  return a;
}

/** Convert a dense index-aligned vector to a sparse {@link LimbicDelta}. */
function arrayToDelta(arr: ArrayLike<number>): LimbicDelta {
  const d: LimbicDelta = {};
  for (let i = 0; i < LIMBIC_DIM_NAMES.length; i++) d[LIMBIC_DIM_NAMES[i]!] = arr[i] ?? 0;
  return d;
}

/** Deterministic hashed trigram embedding → unit-norm Float32Array(dim). */
export function hashedEmbedding(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim);
  const s = text.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const tri = s.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < tri.length; j++) {
      h ^= tri.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    const idx = (h >>> 0) % dim;
    v[idx] = v[idx]! + (((h >>> 24) & 1) === 0 ? 1 : -1);
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] = v[i]! / norm;
  return v;
}

// arrayToState re-exported for the service's consumers (session restore).
export { arrayToState };

// ── Singleton wiring (mirrors ssm-memory-service) ──────────────────────────────

let _service: LimbicSystemService | null = null;

export function getLimbicSystemService(): LimbicSystemService | null {
  return _service;
}

export async function initLimbicSystemService(
  opts: LimbicSystemServiceOptions = {},
): Promise<LimbicSystemService> {
  _service = await LimbicSystemService.create(opts);
  return _service;
}
