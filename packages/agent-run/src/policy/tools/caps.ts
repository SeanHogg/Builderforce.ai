/**
 * caps — the ONE window-sized result cap (PRD 35 §6.10), and the cloud surface's
 * capability set.
 *
 * THE CAP. This is the only place the port re-derives a shared package's rule rather
 * than reusing it. The rule is one line and must be identical to
 * `packages/tool-output-policy/src/caps.ts` `windowedCap` — the Worker build resolves
 * `@builderforce/tool-output-policy` through the nearest tsconfig and cannot be made
 * to see a mapping from here, so importing the package would not typecheck in every
 * host. THE RULE (identical to the package, do not drift):
 *
 *   • no / invalid window (`NaN`, ≤ 0, non-finite) ⇒ the tool's fixed table cap;
 *   • `read_file` ⇒ `clamp(windowToolResultCap(window), tableCap, 64_000)`, where
 *     `windowToolResultCap = clamp(floor(window × 0.3) × 4, MIN_KEEP, HARD_MAX)`;
 *   • every other tool ⇒ `min(tableCap, windowToolResultCap(window))`.
 *
 * When WS8a's tool-output-policy port lands in the workspace, THIS FILE is deleted and
 * the call sites import `windowedCap` from the package — the constants are already
 * re-exported here under the package's exact names so the swap is an import edit only.
 *
 * THE CAPABILITY SET. The cloud surface's tool list derives from ONE capability set
 * (`cloudAgentTools.ts` `CLOUD_SURFACE_CAPS`), plus the sandbox's `shell` when the run
 * has one (`runSurfaceCaps.ts` `prepSurfaceCaps`). Ported here so the policy owns the
 * same derivation. Levers are applied by the caller through `withCostLeverCaps` shapes;
 * the C5 `repo.semantic` backing (`durableRepoSemantic`) is cloud-only and is NOT
 * portable — it stays in the cloud adapter (WS3).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { Capability, ToolSchema } from "@builderforce/agent-tools";

// ── THE result-cap constants (must mirror tool-output-policy/src/caps.ts) ───────

/** The generic per-tool output cap when the table names no row. */
export const DEFAULT_TOOL_OUTPUT_CHARS = 6000;
/** A single tool result never exceeds this, whatever the window. */
export const HARD_MAX_TOOL_RESULT_CHARS = 400000;
/** A single tool result is never cut below this. */
export const MIN_KEEP_CHARS = 2000;
/** Chars per token when sizing a window share. */
export const CHARS_PER_TOKEN = 4;
/** The window share a tool result may take. */
export const WINDOW_SHARE = 0.3;
/** `read_file` may never be raised past this, whatever the window. */
export const READ_FILE_MAX_CHARS = 64000;

/** The fixed per-tool table cap (mirror of `TOOL_OUTPUT_CAPS` + generic default). */
export function toolOutputCap(tool: string, table?: Readonly<Record<string, number>>): number {
  const row = table?.[tool];
  if (typeof row === "number") return row;
  switch (tool) {
    case "read_file":
      return 16000;
    case "run_command":
    case "exec":
    case "bash":
    case "shell":
    case "git_status":
    case "git_diff":
    case "git_history":
    case "git_sync_latest":
    case "git_undo":
    case "git_redo":
      return 20000;
    case "wait_agents":
      return 34000;
    default:
      return DEFAULT_TOOL_OUTPUT_CHARS;
  }
}

/**
 * The window-sized share a tool result may take: 30% of the window in chars, clamped to
 * `[MIN_KEEP, HARD_MAX]`. Mirror of `windowToolResultCap`.
 */
export function windowToolResultCap(windowTokens: number): number {
  if (!Number.isFinite(windowTokens) || windowTokens <= 0) return HARD_MAX_TOOL_RESULT_CHARS;
  const share = Math.floor(windowTokens * WINDOW_SHARE) * CHARS_PER_TOKEN;
  return Math.min(HARD_MAX_TOOL_RESULT_CHARS, Math.max(MIN_KEEP_CHARS, share));
}

/**
 * THE one window-sized cap (PRD 35 §6.10). Identical to `windowedCap`: unknown window ⇒
 * the table cap; `read_file` is clamped UP to at least the table row and capped at 64K;
 * every other tool takes `min(tableCap, windowShare)`.
 */
export function windowedCap(tool: string, tableCap: number, windowTokens?: number): number {
  if (windowTokens === undefined || !Number.isFinite(windowTokens) || windowTokens <= 0) return tableCap;
  const cap = windowToolResultCap(windowTokens);
  if (tool === "read_file") return Math.min(READ_FILE_MAX_CHARS, Math.max(tableCap, cap));
  return Math.min(tableCap, cap);
}

// ── The cloud surface capability set (cloudAgentTools.ts + runSurfaceCaps.ts) ───

/**
 * The durable/Worker surface's capability set (`cloudAgentTools.ts` `CLOUD_SURFACE_CAPS`).
 * The comment block in the source is authoritative; this is the same set, verbatim.
 */
export const CLOUD_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read", "repo.search", "repo.write", "repo.edit", "repo.delete", "static-check", "human", "memory", "memory.forget",
  "coordinate", "prd.write", "web", "web.search",
  "skill.author",
  "orchestrate", "orchestrate.fanout", "orchestrate.live",
]);

/** The capabilities a sandbox adds — exactly `shell` (sandboxProvider). */
export const SANDBOX_CAPABILITIES: readonly Capability[] = ["shell"];

/** The cost-lever → capabilities rows (C5 adds `repo.semantic`). */
export interface CostLeverCapsRow {
  lever: string;
  caps: readonly Capability[];
}

/** `base` plus every capability an ON lever adds for this tenant. */
export function withCostLeverCaps(
  base: ReadonlySet<Capability>,
  rows: readonly CostLeverCapsRow[],
  isLeverOn: (lever: string) => boolean,
): ReadonlySet<Capability> {
  const added = rows.filter((row) => isLeverOn(row.lever)).flatMap((row) => row.caps);
  return added.length === 0 ? base : new Set<Capability>([...base, ...added]);
}

/** A cloud run's capability set for a tenant (levers applied) — `cloudSurfaceCapsFor`. */
export function cloudSurfaceCapsFor(
  env: unknown,
  tenantId: number | string | null | undefined,
  isLeverOn: (lever: string) => boolean,
  leverRows: readonly CostLeverCapsRow[] = [{ lever: "c5_cloud_repo_map", caps: ["repo.semantic"] }],
): ReadonlySet<Capability> {
  void env;
  void tenantId;
  return withCostLeverCaps(CLOUD_SURFACE_CAPS, leverRows, isLeverOn);
}

/**
 * The capability set prep issues the run identity with (`prepSurfaceCaps`): the cloud
 * set with levers applied, plus the sandbox's `shell` for a sandboxed run.
 */
export function prepSurfaceCaps(
  env: unknown,
  tenantId: number | string | null | undefined,
  sandboxed: boolean,
  isLeverOn: (lever: string) => boolean,
): ReadonlySet<Capability> {
  const base = cloudSurfaceCapsFor(env, tenantId, isLeverOn);
  return sandboxed ? new Set<Capability>([...base, ...SANDBOX_CAPABILITIES]) : base;
}

/**
 * `durableRunCaps`' pure core: `repo.semantic` only while the run holds it AND a
 * repository backs it (never advertise a tool that is certain to fail), then narrowed
 * by its place in a delegation tree. The repo-map BACKING (`createCloudRepoSemantic`)
 * is cloud-only and stays in the adapter; this is the set-level rule only.
 */
export function durableRunCaps(
  prepCaps: ReadonlySet<Capability>,
  hasRepo: boolean,
  hasDelegationPlace: boolean,
): ReadonlySet<Capability> {
  let caps = prepCaps;
  if (!hasRepo && caps.has("repo.semantic")) {
    caps = new Set([...caps].filter((c) => c !== "repo.semantic"));
  }
  // delegationCaps: a run with no place in a tree (a rehearsal) holds no delegation.
  if (!hasDelegationPlace) {
    caps = new Set([...caps].filter((c) => c !== "orchestrate" && c !== "orchestrate.fanout" && c !== "orchestrate.live"));
  }
  return caps;
}

/** The schema names a capability set advertises (identity over a registry's derivation). */
export function advertisedToolNames(
  caps: ReadonlySet<Capability>,
  schemasForCapabilities: (caps: ReadonlySet<Capability>) => readonly ToolSchema[],
): string[] {
  return schemasForCapabilities(caps)
    .map((t) => t.function?.name ?? "")
    .filter(Boolean)
    .sort();
}
