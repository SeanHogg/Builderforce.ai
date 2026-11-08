/**
 * Who may create, rotate or remove a stored integration key or connector connection.
 * The server enforces the same rule (`requireRole(MANAGER)`); this only decides
 * whether the controls are offered. ONE definition, for every surface that connects
 * a system — settings, the connectors gallery, and the workflow step form.
 */
export function canManageIntegrations(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}
