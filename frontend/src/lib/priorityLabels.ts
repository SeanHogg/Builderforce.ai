/**
 * Priority Labels Mapping
 * Maps priority levels to user-friendly labels
 */

export const priorityLabels: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  null: 'Unassigned',
  undefined: 'Unassigned',
};

/**
 * Get the label for a priority level
 */
export function getPriorityLabel(priority: string | null | undefined): string {
  return priorityLabels[priority] || 'Unassigned';
}