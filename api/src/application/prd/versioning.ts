/**
 * PRD versioning — PURE decision logic (no IO).
 *
 * specVersions are immutable, monotonic snapshots of a spec/PRD. Once an
 * execution uses a version it is FROZEN and may never be mutated again
 * (freeze-on-execute immutability). These helpers compute the next version
 * number, guard the freeze invariant, and build the insert payload for a
 * frozen snapshot of a spec.
 */

/** Minimal spec shape needed to snapshot into a spec_versions row. */
export interface SnapshotableSpec {
  id:          string;
  tenantId:    number;
  segmentId?:  string | null;
  prd?:        string | null;
  archSpec?:   string | null;
  /** Already-serialized JSON text (or null). The specs.taskList column is text. */
  taskList?:   string | null;
}

/** Insert payload for the spec_versions table (text columns already serialized). */
export interface SpecVersionInsert {
  tenantId:   number;
  segmentId:  string | null;
  specId:     string;
  version:    number;
  prd:        string | null;
  archSpec:   string | null;
  taskList:   string | null;
  origin:     string;
  frozen:     boolean;
  frozenAt:   Date | null;
  createdBy:  string | null;
}

export class FrozenVersionError extends Error {
  constructor(message = 'spec version is frozen and cannot be modified') {
    super(message);
    this.name = 'FrozenVersionError';
  }
}

/**
 * Compute the next monotonic version number. Versions start at 1 and always
 * exceed the current maximum, even if the existing set has gaps or duplicates.
 */
export function nextVersionNumber(existing: number[]): number {
  let max = 0;
  for (const v of existing) {
    if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v;
  }
  return max + 1;
}

/**
 * Guard the freeze-on-execute invariant. Throws FrozenVersionError if the
 * version is frozen. Returns void otherwise.
 */
export function assertNotFrozen(version: { frozen: boolean }): void {
  if (version.frozen) {
    throw new FrozenVersionError();
  }
}

/**
 * Build a frozen spec_versions insert payload from the current spec state.
 * `now` is injected (pure — no Date.now() side effect). `origin` defaults to
 * 'prd_first'; pass 'generated_from_ticket' for AI-generated PRDs.
 */
export function buildFrozenSnapshot(
  spec: SnapshotableSpec,
  version: number,
  now: Date,
  opts: { origin?: string; createdBy?: string | null } = {},
): SpecVersionInsert {
  return {
    tenantId:  spec.tenantId,
    segmentId: spec.segmentId ?? null,
    specId:    spec.id,
    version,
    prd:       spec.prd ?? null,
    archSpec:  spec.archSpec ?? null,
    taskList:  spec.taskList ?? null,
    origin:    opts.origin ?? 'prd_first',
    frozen:    true,
    frozenAt:  now,
    createdBy: opts.createdBy ?? null,
  };
}
