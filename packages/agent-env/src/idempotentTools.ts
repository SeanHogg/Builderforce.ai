/**
 * idempotentTools — no repeated side effects (W12 phase 4, constraint 4). Every mutating tool call carries an idempotency key
 * (run id, step, tool-call id). Before a mutating call runs, its key is looked up in the run's tool-result ledger: a recorded
 * result is REPLAYED and the tool is not invoked. Results are recorded at the tool-result boundary and written once per step
 * (`endStep`), so a step costs one ledger write however many calls it made — the checkpoint cost the design review asked for.
 *
 * A mutating call is written ahead (its key, before it runs), so a resume can tell "never ran" from "may have run". A key found
 * written-ahead but unrecorded is re-invoked WITH the key when the tool honours keys (our own `env.*` tools dedupe on it); an
 * external tool whose catalog entry lacks idempotency support is `unsafe-to-replay`, and a person is asked before it runs again.
 *
 * The gate sits at `PlatformTools.execute`, the one dispatch seam that is handed the call id and the step
 * (`idempotentPlatformTools`). A `CapabilityProvider` service method is handed neither, so it cannot carry a key.
 */
import type { HumanChannel, PlatformToolResult, PlatformTools } from "@builderforce/agent-run";

// ── The key (structurally the webcontainers core contract `agents/contract.ts`) ──────────────────────────────────────────

/** Identifies one tool call of one run step, so a resumed run never repeats it. Mirrors `@seanhogg/builderforce-webcontainers-core`. */
export interface IdempotencyKey {
  readonly runId: string;
  readonly step: number;
  readonly toolCallId: string;
}

/** The key's one string form — identical to the core contract's `idempotencyKeyString`. */
export const idempotencyKeyString = (key: IdempotencyKey): string => `${key.runId}:${key.step}:${key.toolCallId}`;

/** Whether each environment tool changes state. Mirrors core `ENV_TOOL_MUTATES`; the open runtime owns the list. */
export const ENV_TOOL_MUTATES: Readonly<Record<string, boolean>> = {
  "env.fs.read": false,
  "env.fs.write": true,
  "env.fs.list": false,
  "env.run": true,
  "env.preview.fetch": false,
  "env.services.status": false,
};

/** Whether `tool` is one of the environment's own `env.*` tools. Mirrors core `isEnvToolKey`. */
export const isEnvToolKey = (tool: string): boolean => Object.prototype.hasOwnProperty.call(ENV_TOOL_MUTATES, tool);

/** The function name an `env.*` tool is advertised under: a model's function names allow no dots. */
export const envToolName = (key: string): string => key.replace(/\./g, "_");

const ENV_KEY_BY_NAME: ReadonlyMap<string, string> = new Map(Object.keys(ENV_TOOL_MUTATES).map((key) => [envToolName(key), key]));

/** The `env.*` key an advertised function name (`env_fs_read`) or the key itself stands for, or undefined for any other tool. */
export const envToolKeyOf = (tool: string): string | undefined => (isEnvToolKey(tool) ? tool : ENV_KEY_BY_NAME.get(tool));

// ── The ledger port ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A tool result as the ledger keeps it: plain JSON, enough to hand the model the same answer again. */
export interface RecordedToolResult {
  data: unknown;
  isError?: boolean;
}

/** What the ledger knows of one key: written ahead (the call may have run), or recorded with its result. */
export type LedgerEntry =
  | { state: "pending"; tool: string }
  | { state: "recorded"; tool: string; result: RecordedToolResult };

/** One recorded call of a step. */
export interface LedgerRecord {
  key: string;
  tool: string;
  result: RecordedToolResult;
}

/**
 * Where a run's tool results live beside its checkpoints. The ONE run store (`RunStore`) keeps run state only, so this is a
 * narrow port of its own; a host backs it with the same storage as the run store.
 */
export interface ToolResultLedger {
  /** What is known of each key. A key the ledger never saw is absent from the map. */
  get(keys: readonly string[]): Promise<Map<string, LedgerEntry>>;
  /** Mark a call as about to run, BEFORE it runs. */
  writeAhead(key: string, tool: string): Promise<void>;
  /** Record a step's results in ONE write. */
  recordStep(step: number, entries: readonly LedgerRecord[]): Promise<void>;
}

/** An in-memory ledger (tests, an `ephemeral` environment). `writes` counts every write, so a test can assert the batching. */
export interface MemoryToolResultLedger extends ToolResultLedger {
  readonly writes: { writeAhead: number; recordStep: number };
}

export function createMemoryToolResultLedger(): MemoryToolResultLedger {
  const entries = new Map<string, LedgerEntry>();
  const writes = { writeAhead: 0, recordStep: 0 };
  return {
    writes,
    async get(keys) {
      const found = new Map<string, LedgerEntry>();
      for (const key of keys) {
        const entry = entries.get(key);
        if (entry) found.set(key, structuredClone(entry));
      }
      return found;
    },
    async writeAhead(key, tool) {
      writes.writeAhead += 1;
      if (entries.get(key)?.state !== "recorded") entries.set(key, { state: "pending", tool });
    },
    async recordStep(_step, records) {
      writes.recordStep += 1;
      for (const record of records) entries.set(record.key, { state: "recorded", tool: record.tool, result: structuredClone(record.result) });
    },
  };
}

// ── What a tool does ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A tool's replay class: whether it changes state, and whether it honours an idempotency key itself. */
export interface ToolEffect {
  mutates: boolean;
  idempotent: boolean;
}

/** The catalog's word on a tool, as the gate reads it. */
export interface ToolEffects {
  effect(tool: string): ToolEffect;
}

/** One external (catalog) tool's entry: `idempotency` is true only when the tool honours a key itself. */
export interface CatalogToolEntry {
  mutates?: boolean;
  idempotency?: boolean;
}

/**
 * The environment's own `env.*` tools (they honour the key), then the catalog's entries. A tool the catalog does not
 * classify is a non-idempotent mutation: fail closed, as the governance class gate does.
 */
export function catalogToolEffects(catalog: Readonly<Record<string, CatalogToolEntry>> = {}): ToolEffects {
  return {
    effect(tool) {
      const envKey = envToolKeyOf(tool);
      if (envKey !== undefined) return { mutates: ENV_TOOL_MUTATES[envKey] === true, idempotent: true };
      const entry = catalog[tool];
      return { mutates: entry?.mutates ?? true, idempotent: entry?.idempotency === true };
    },
  };
}

// ── The gate ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The options a person is offered for an unsafe-to-replay call, in order. */
export const UNSAFE_REPLAY_OPTIONS = ["re-run", "skip"] as const;

export interface IdempotentToolsDeps {
  ledger: ToolResultLedger;
  effects: ToolEffects;
  /** The run's human port: an unsafe-to-replay call is put to a person (`ask_human`). */
  human: HumanChannel;
}

/** A tool's answer, as the gate hands it on. `replayed` marks a result the ledger answered without invoking. */
export type GatedResult<R extends RecordedToolResult> = R | (RecordedToolResult & { replayed: true });

export interface IdempotentTools {
  /** The catalog's word on `tool` (the gate's own classification). */
  effect(tool: string): ToolEffect;
  /** Run one call under its key. `invoke` receives the key, so a tool that dedupes (our `env.*`) is handed it. */
  call<R extends RecordedToolResult>(key: IdempotencyKey, tool: string, invoke: (key: IdempotencyKey) => Promise<R>): Promise<GatedResult<R>>;
  /** The step's calls have all returned: record their results in one write. A step with nothing to record writes nothing. */
  endStep(step: number): Promise<void>;
}

export function createIdempotentTools(deps: IdempotentToolsDeps): IdempotentTools {
  const { ledger, effects, human } = deps;
  const buffered = new Map<number, LedgerRecord[]>();

  const remember = (key: IdempotencyKey, tool: string, result: RecordedToolResult): void => {
    const record: LedgerRecord = { key: idempotencyKeyString(key), tool, result: recordable(result) };
    const step = buffered.get(key.step);
    if (step) step.push(record);
    else buffered.set(key.step, [record]);
  };

  /** A key written ahead and never recorded, of a tool that does not honour keys: a person decides whether it runs again. */
  const askBeforeRerun = async <R extends RecordedToolResult>(key: IdempotencyKey, tool: string, invoke: (key: IdempotencyKey) => Promise<R>): Promise<GatedResult<R>> => {
    const answer = await human.ask(
      `The run was interrupted while \`${tool}\` was running (call ${key.toolCallId}, step ${key.step}). It may already have taken effect, and it cannot be safely repeated. Run it again?`,
      UNSAFE_REPLAY_OPTIONS,
    );
    // A parked ask records nothing: the next resume asks again.
    if (answer.kind === "paused") return unsafeResult(tool, "waiting for a person to decide whether to run it again");
    const rerun = answer.approved ?? answer.answer.trim().toLowerCase() === UNSAFE_REPLAY_OPTIONS[0];
    if (rerun) {
      const result = await invoke(key);
      remember(key, tool, result);
      return result;
    }
    const skipped = unsafeResult(tool, "a person chose not to run it again");
    remember(key, tool, skipped);
    return skipped;
  };

  return {
    effect: (tool) => effects.effect(tool),

    async call(key, tool, invoke) {
      const effect = effects.effect(tool);
      if (!effect.mutates) return invoke(key);
      const id = idempotencyKeyString(key);
      const known = (await ledger.get([id])).get(id);
      if (known?.state === "recorded") return { ...known.result, replayed: true as const };
      if (known?.state === "pending" && !effect.idempotent) return askBeforeRerun(key, tool, invoke);
      if (!known) await ledger.writeAhead(id, tool);
      // A throw is the tool's failure: nothing is recorded, so the written-ahead key says "may have run" to a resume.
      const result = await invoke(key);
      remember(key, tool, result);
      return result;
    },

    async endStep(step) {
      const records = buffered.get(step);
      if (!records?.length) return;
      await ledger.recordStep(step, records);
      buffered.delete(step);
    },
  };
}

/** The result a call a person has not (yet) allowed to run again gets. */
function unsafeResult(tool: string, why: string): RecordedToolResult & { replayed: true } {
  return { data: { ok: false, unsafeToReplay: true, tool, error: `unsafe-to-replay: \`${tool}\` was not run again — ${why}.` }, isError: true, replayed: true };
}

/** The JSON a result is recorded as: the model-facing payload and its verdict. */
function recordable(result: RecordedToolResult): RecordedToolResult {
  return { data: result.data, ...(result.isError ? { isError: true } : {}) };
}

// ── The PlatformTools adapter ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The surface's tools, gated: each call is keyed by `(runId, step, callId)`, and `turnEnded` — the kernel's step boundary,
 * after every call of the turn returned — writes the step's results. Everything else is the wrapped surface's own.
 */
export function idempotentPlatformTools(platform: PlatformTools, tools: IdempotentTools, runId: string): PlatformTools {
  const gated: Pick<PlatformTools, "execute" | "turnEnded"> = {
    async execute(name, args, env) {
      if (env.callId === undefined) {
        if (tools.effect(name).mutates) return { data: { ok: false, error: `\`${name}\` changes state and was called without a call id, so it cannot be keyed.` }, isError: true };
        return platform.execute(name, args, env);
      }
      const key: IdempotencyKey = { runId, step: env.step, toolCallId: env.callId };
      const result = await tools.call<PlatformToolResult & RecordedToolResult>(key, name, () => platform.execute(name, args, env));
      if ("replayed" in result) return { data: result.data, ...(result.isError ? { isError: true } : {}) };
      return result;
    },
    async turnEnded(env) {
      await platform.turnEnded?.(env);
      await tools.endStep(env.step);
    },
  };
  return Object.assign(Object.create(platform) as PlatformTools, gated);
}

