/**
 * Who may write which agent assignment — ONE rule for the REST router and the Brain/MCP
 * tools, so the two surfaces cannot drift.
 *
 * Project staffing and workspace identities (the {@link CONFIGURABLE_SCOPES}) are a
 * MANAGER+ act, as they were on the retired project-agents routes. The other routable
 * scopes keep their existing gate (any authenticated member). A ROLE-LESS caller — a
 * cloud agent or server acting under its own run's authority — is left to that run, the
 * same convention `builtinToolAuthority` applies to every builtin tool.
 */
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { CONFIGURABLE_SCOPES, type AssignmentScope } from './agentAssignmentModel';

export function scopeRequiresManager(scope: AssignmentScope): boolean {
  return CONFIGURABLE_SCOPES.includes(scope);
}

/** True when a caller holding `role` may write an assignment in `scope`. */
export function mayWriteAssignmentScope(role: TenantRole | undefined, scope: AssignmentScope): boolean {
  if (!scopeRequiresManager(scope)) return true;
  if (role === undefined) return true;
  return hasMinRole(role, TenantRole.MANAGER);
}
