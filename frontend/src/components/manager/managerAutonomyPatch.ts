import type { ManagerConfigPatch } from '@/lib/builderforceApi';
import type { ManagerAutonomyValue } from '@/components/manager/ManagerAutonomyControls';

/**
 * Translate a patch from the shared (tri-state) control set into the project config patch
 * the API takes.
 *
 * Only `allowAutoMerge` is nullable on a project row, so a `null` on any other field would
 * be a write the column cannot hold — dropped here rather than coerced, because coercing
 * `null` to `false` on e.g. `enabled` would silently pause a project the user was trying
 * to leave alone.
 */
export function autonomyPatchToConfigPatch(patch: Partial<ManagerAutonomyValue>): ManagerConfigPatch {
  const out: ManagerConfigPatch = {};
  if (patch.allowAutoMerge !== undefined) out.allowAutoMerge = patch.allowAutoMerge;
  if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
  if (typeof patch.requireSignoffToComplete === 'boolean') out.requireSignoffToComplete = patch.requireSignoffToComplete;
  // Project-only and NOT NULL, so it narrows to a boolean exactly like the 0265 columns
  // above — there is no workspace tier for a `null` here to inherit from.
  if (typeof patch.coordinationRequiresManager === 'boolean') out.coordinationRequiresManager = patch.coordinationRequiresManager;
  if (typeof patch.autoAssign === 'boolean') out.autoAssign = patch.autoAssign;
  if (typeof patch.autoBusinessValue === 'boolean') out.autoBusinessValue = patch.autoBusinessValue;
  if (typeof patch.autoPrioritize === 'boolean') out.autoPrioritize = patch.autoPrioritize;
  if (typeof patch.autoSchedule === 'boolean') out.autoSchedule = patch.autoSchedule;
  if (patch.prMergePolicy != null) out.prMergePolicy = patch.prMergePolicy;
  // Ceremony autonomy (0365) is tri-state at the PROJECT tier too — these columns are
  // new, so `null` genuinely means "inherit the workspace answer" and must pass through
  // rather than being narrowed to a boolean like the 0265 columns above.
  if (patch.allowUnattendedCeremonies !== undefined) out.allowUnattendedCeremonies = patch.allowUnattendedCeremonies;
  if (patch.allowAgentReassignment !== undefined) out.allowAgentReassignment = patch.allowAgentReassignment;
  if (patch.allowAutoStaffLanes !== undefined) out.allowAutoStaffLanes = patch.allowAutoStaffLanes;
  if (patch.agentReassignIdleHours !== undefined) out.agentReassignIdleHours = patch.agentReassignIdleHours;
  if (patch.agentReassignMaxPerSession !== undefined) out.agentReassignMaxPerSession = patch.agentReassignMaxPerSession;
  // Ship mode (PRD 48) — tri-state: `null` = inherit the workspace default, passed through.
  if (patch.shipMode !== undefined) out.shipMode = patch.shipMode;
  return out;
}
