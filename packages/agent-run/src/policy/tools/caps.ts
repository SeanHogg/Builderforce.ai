/**
 * caps — the ONE window-sized result cap (PRD 35 §6.10), and the cloud surface's
 * capability set.
 *
 * THE CAP is `@builderforce/tool-output-policy`'s `windowedCap` / `toolOutputCap`, reused,
 * never re-derived (this package's tsconfig maps the source package, and `truncation.ts`
 * already imports it). The rule, for the reader:
 *
 *   • no / invalid window ⇒ the tool's fixed table cap;
 *   • `read_file` ⇒ `clamp(windowToolResultCap(window), tableCap, 64_000)`;
 *   • every other tool ⇒ `min(tableCap, windowToolResultCap(window))`.
 *
 * {@link resultCapFor} is the one call a dispatch site makes: the table row for the tool,
 * sized by the serving model's window (`ModelTransport.window()`, PRD 35 §3.2).
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
import { shapeToolResult, toolOutputCap, windowedCap } from "@builderforce/tool-output-policy";

export { toolOutputCap, windowedCap };

/**
 * The cap on one tool's result for this run: the package's table row, sized by the
 * serving model's context window. Unknown model or window ⇒ the table row (today's caps).
 */
export function resultCapFor(
  tool: string,
  model: { window?(model: string): number | undefined },
  servingModel: string | undefined,
): number {
  const window = servingModel && typeof model.window === "function" ? model.window(servingModel) : undefined;
  return windowedCap(tool, toolOutputCap(tool), window);
}

/**
 * One dispatched result, capped to {@link resultCapFor} by the package's shaper
 * (`shapeToolResult` — a `read_file` is windowed, anything else cut head+tail). Returns
 * the result itself when it fits, so an uncapped result is never re-serialised.
 */
export function capToolResult(tool: string, data: unknown, maxChars: number): unknown {
  const shaped = shapeToolResult(tool, data, { maxChars });
  if (!shaped.truncated) return data;
  try {
    return JSON.parse(shaped.content) as unknown;
  } catch {
    return shaped.content;
  }
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
