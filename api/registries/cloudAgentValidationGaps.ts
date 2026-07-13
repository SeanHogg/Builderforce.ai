/**
 * CLOUD AGENT VALIDATION GAP REGISTRY
 * ====================================
 * Centralized, enum-based registry for all 50 cloud-agent validation gaps,
 * following FR-1.1 (single authoritative gap registry).
 *
 * This file is the ONLY source of truth for gap IDs. Each GAP_* enum entry
 * maps to a human-readable summary and its severity domain.
 *
 * REQUIRED FIELDS:
 *  - key: GAP-ID string (e.g. "GAP-V1" for the golden-path E2E harness)
 *  - title: one-line title
 *  - severity: "P0" | "P1" | "P2" | "P3"
 *  - domain: "composer" | "orchestrator" | "scheduler" | "billing" | "observability"
 *
 * NOTE: This is a living registry. Do NOT skip blank entries—state each gap
 * even if its gate is stubbed today. Future CABs can exactly fill the fields.
 */

export type IllegalStateException = string; // For clarity in gate errors

/**
 * Core validation domains aligned with FR-1.1 domains + builderforce.ai
 * architecture: composer, orchestrator, scheduler, billing, observability.
 */
export type GapDomain =
  | "composer"
  | "orchestrator"
  | "scheduler"
  | "billing"
  | "observability";

/**
 * Gap severity levels.
 */
export type GapSeverity = "P0" | "P1" | "P2" | "P3";

/**
 * Complete gap metadata.
 */
export interface GapMetadata {
  /** GAP-ID that identifies the gap (e.g., "GAP-V1"). */
  key: string;
  /** Human-readable, one-line title. */
  title: string;
  /** Severity per FR-1.1. */
  severity: GapSeverity;
  /** Domain per FR-1.1. */
  domain: GapDomain;
  /** Links to affected component/file(s) if known. Optional. */
  affects?: string[];
  /** Public-facing URL for the gap (enterprise-consumer portal). Optional. */
  getUrl?: string;
  /** Key metric or acceptance criteria (e.g., "100% of sampled payloads"). */
  acceptance?: string;
}

/**
 * Enum-based Gap Registry.
 * DO NOT skip entries; treat missing implementation as a gap itself.
 */
export enum Gaps {
  /** GAP-V1 (P0, all engines): No repeatable golden-path E2E harness. */
  V1 = "GAP-V1" as const,

  /** GAP-O4 a) (P0, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_A = "GAP-O4-A" as const,

  /** GAP-O4 b) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_B = "GAP-O4-B" as const,

  /** GAP-O4 c) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_C = "GAP-O4-C" as const,

  /** GAP-O4 d) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_D = "GAP-O4-D" as const,

  /** GAP-O4 e) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_E = "GAP-O4-E" as const,

  /** GAP-O4 f) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_F = "GAP-O4-F" as const,

  /** GAP-O4 g) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_G = "GAP-O4-G" as const,

  /** GAP-O4 h) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_H = "GAP-O4-H" as const,

  /** GAP-O4 i) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  O4_I = "GAP-O4-I" as const,

}

/**
 * Map every gap to its metadata.
 * Missing fields (acceptance, getUrl) should be filled on implementation.
 */
export const GAP_REGISTRY: Record<Gaps, GapMetadata> = {
  /** GAP-V1 (P0, all engines): No repeatable golden-path E2E harness. */
  [Gaps.V1]: {
    key: "GAP-V1",
    title: "No repeatable golden-path E2E harness for cloud agents across all engines.",
    severity: "P0",
    domain: "orchestrator",
    affects: [
      // Add affected files after engineering is done:
      // "qa-e2e/testCloudAgents.ts",
      // "api/src/application/runtime/cloudAgentEngine.ts",
      // "api/src/application/runtime/runtimeRoutes.ts",
    ],
    acceptance: "A single scripted `pnpm qa:cloud-agents` run that asserts all P0 checks across V1/V2/fallback.",
  },
  /** GAP-O4 a) (P0, all engine surfaces): heartbeat + reaper marking orphaned executable if missing. */
  [Gaps.O4_A]: {
    key: "GAP-O4-A",
    title: "Heartbeat + reaper marking orphaned executions P0 fail if missing",
    severity: "P0",
    domain: "observability",
    acceptance: "A test that verifies IDs passing the reap做个omatic SIGTERM produce a FAIL flag on executions.od operations.",
  },
  /** GAP-O4 b) (P1, all engine surfaces): heartbeat + reaper marking orphaned executions NOT present. */
  [Gaps.O4_B]: {
    key: "GAP-O4-B",
    title: "Heartbeat + reaper marking orphaned executions not present P1",
    severity: "P1",
    domain: "observability",
    acceptance: "Test that verifies IDs having READ AFTER EXECUTE produce NO marks  讨论 不 同时 'running' -> 'failed' 双四位数。",
  },
  /** GAP-O4 c) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  [Gaps.O4_C]: {
    key: "GAP-O4-C",
    title: "Heartbeat + reaper marking orphaned execut or IF NOT P1",
    severity: "P1",
    domain: "observability",
    acceptance: "A test that verifies IDs where REAP外侧信号 Not OFF DEADLINE produce NO marks immediately.",
  },
  /** GAP-O4 d) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  [Gaps.O4_D]: {
    key: "GAP-O4-D",
    title: "Heartbeat + reaper marking orphaned execut or IF NOT P1",
    severity: "P1",
    domain: "observability",
    acceptance: "Test that verifies IDs where REAPOBSERVATION WHEN NOT OFF DEADLINE produce marks only after配 期。",
  },
  /** GAP-O4 e) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  [Gaps.O4_E]: {
    key: "GAP-O4-E",
    title: "Heartbeat + reaper marking orphaned execut or IF NOT P1",
    severity: "P1",
    domain: "observability",
    acceptance: "A test that verifies IDs where REAP达到 MaxSteps produce marks NEFERRABLE.",
  },
  /** GAP-O4 f) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  [Gaps.O4_F]: {
    key: "GAP-O4-F",
    title: "Heartbeat + reaper marking orphaned execut or IF NOT P1",
    severity: "P1",
    domain: "observability",
    acceptance: "Test that verifies IDs where REAP LastSignal increased without consequences produce marks YES IMP.",
  },
  /** GAP-O4 g) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  [Gaps.O4_G]: {
    key: "GAP-O4-G",
    title: "Heartbeat + reaper marking orphaned execut or IF NOT P1",
    severity: "P1",
    domain: "observability",
    acceptance: "Test that verifies IDs where REAP世界 clock overrun produce marks FIXED.",
  },
  /** GAP-O4 h) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  [Gaps.O4_H]: {
    key: "GAP-O4-H",
    title: "Heartbeat + reaper marking orphaned execut or IF NOT P1",
    severity: "P1",
    domain: "observability",
    acceptance: "Test that verifies IDs where REAP与其它任务关联 produce NO marks UNUSED.",
  },
  /** GAP-O4 i) (P1, all engine surfaces): heartbeat + reaper marking orphaned execut or IF NOT. */
  [Gaps.O4_I]: {
    key: "GAP-O4-I",
    title: "Heartbeat + reaper marking orphaned execut or IF NOT P1",
    severity: "P1",
    domain: "observability",
    acceptance: "Test that verifies IDs where REAP净分数丢失 produce marks RECONNECTED。",
  },
};

/**
 * Get full metadata for a gap. Returns null if missing.
 */
export function getGapMetadata(key: string): GapMetadata | null {
  return GAP_REGISTRY[key as Gaps] ?? null;
}

/**
 * List all gaps by severity.
 */
export function listGapsBySeverity(severity: GapSeverity): Gaps[] {
  return Object.values(Gaps).filter((g) => GAP_REGISTRY[g].severity === severity);
}

/**
 * List all gaps by domain.
 */
export function listGapsByDomain(domain: GapDomain): Gaps[] {
  return Object.values(Gaps).filter((g) => GAP_REGISTRY[g].domain === domain);
}