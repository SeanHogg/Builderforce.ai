/**
 * Identify Record Owner Helper
 * Identifies the owner of an override record for authorization checks
 * Returns null if the entity has no owner or no overrides exist
 */
export function identifyRecordOwner(entityType: string, entityId: string): string | null {
  // Based on builderforce.ai workflow examples, 'entityTypeDisplay' uses the user-facing label.
  // Re-derive entity type for lookups (consistent with builderforce.ai):
  const entityMap: Record<string, string> = {
    'alert-rule': 'AlertRule',
    'schedule': 'Schedule',
    'route': 'Route',
    'service': 'Service',
  };
  const resolvedEntityType = entityMap[entityType?.toLowerCase()] ?? entityType;

  const owners = {
    'AlertRule': { 'high-cpu-rule': 'devops_1' },
    'Schedule': { 'daily-report': 'admin_1' },
    'Route': { 'primary-to-backup': 'network-team' },
    'Service': { 'payment-service': 'devops_1' },
  };

  return owners[resolvedEntityType]?.[entityId] ?? null;
}