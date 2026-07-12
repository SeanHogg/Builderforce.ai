/**
 * Priority Misalignment Types and Utilities
 * Shared definitions for frontend components and API client
 */

import type { TaskMisalignmentCheck } from './priorityMisalignmentApi';
import {
  MisalignmentRuleType,
  PriorityLevel,
  RuleSeverity,
} from '@seanhogg/builderforce-brain-ui';

/**
 * Helper: Map priority level to user-friendly label
 */
export const priorityLabels: Record<PriorityLevel | null | undefined, string> = {
  [PriorityLevel.URGENT]: 'Urgent',
  [PriorityLevel.HIGH]: 'High',
  [PriorityLevel.MEDIUM]: 'Medium',
  [PriorityLevel.LOW]: 'Low',
  null: 'Unassigned',
  undefined: 'Unassigned',
};

/**
 * Helper: Map rule type to user-friendly label
 */
export const ruleTypeLabels: Record<MisalignmentRuleType, string> = {
  [MisalignmentRuleType.HIERARCHICAL]: 'Hierarchical',
  [MisalignmentRuleType.STRATEGIC]: 'Strategic',
  [MisalignmentRuleType.DEPENDENCY]: 'Dependency',
};

/**
 * Helper: Map severity to user-friendly label
 */
export const severityLabels: Record<RuleSeverity, string> = {
  [RuleSeverity.WARNING]: 'Warning',
  [RuleSeverity.ERROR]: 'Error',
};

/**
 * Helper: Map severity to color class
 */
export const severityColors: Record<RuleSeverity, string> = {
  [RuleSeverity.WARNING]: 'text-orange-500',
  [RuleSeverity.ERROR]: 'text-red-600',
};

/**
 * Human-readable explanation for a misalignment check
 */
export interface MisalignmentExplanation {
  code: string;
  title: string;
  description: string;
  hint?: string;
}

/**
 * Explanation codes used in the system
 */
export const ExplanationCodes = {
  HIERARCHICAL_CHILD_HIGHER: 'hierarchical_child_higher',
  HIERARCHICAL_CHILD_LOWER: 'hierarchical_child_lower',
  STRATEGIC_CHILD_HIGHER: 'strategic_child_higher',
  STRATEGIC_CHILD_LOWER: 'strategic_child_lower',
  DEPENDENCY_CHILD_LOWER: 'dependency_child_lower',
  DEPENDENCY_BLOCKER_LOWER: 'dependency_blocker_lower',
  NO_PARENT: 'no_parent',
  NO_STRATEGIC_LINK: 'no_strategic_link',
} as const;

/**
 * Get explanation details for a misalignment check
 */
export function getExplanation(
  type: MisalignmentRuleType,
  details: any
): MisalignmentExplanation | null {
  switch (type) {
    case MisalignmentRuleType.HIERARCHICAL: {
      if (details.parentPriority === undefined) {
        return {
          code: ExplanationCodes.NO_PARENT,
          title: 'No Parent Task',
          description: 'This task has no parent to compare against.',
        };
      }
      if (details.childPriority === undefined || details.parentPriority === undefined) {
        return {
          title: 'Priority Check',
          description: 'Unable to determine priority levels for comparison.',
        };
      }

      const childLabel = priorityLabels[details.childPriority];
      const parentLabel = priorityLabels[details.parentPriority];

      return {
        code: ExplanationCodes.HIERARCHICAL_CHILD_HIGHER,
        title: 'Priority Mismatch',
        description: `Task priority (${childLabel}) deviates from parent priority (${parentLabel}) by ${details.deviation} level(s)`,
        hint: details.actionableHint,
      };
    }

    case MisalignmentRuleType.STRATEGIC: {
      if (!details.expected) {
        return {
          code: ExplanationCodes.NO_STRATEGIC_LINK,
          title: 'Not Linked to Strategic Objective',
          description: 'This task is not linked to a strategic initiative or OKR.',
        };
      }

      if (details.childPriority === undefined || details.expected === undefined) {
        return {
          title: 'Strategic Priority Check',
          description: 'Unable to determine strategic priorities for comparison.',
        };
      }

      const childLabel = priorityLabels[details.childPriority];
      const expectedLabel = priorityLabels[details.expected];
      const direction = details.childPriority > details.expected ? 'higher' : 'lower';

      return {
        code: ExplanationCodes.STRATEGIC_CHILD_HIGHER,
        title: 'Strategic Misalignment',
        description: `Task priority (${childLabel}) is ${direction} than strategic objective/initialive priority (${expectedLabel})`,
        hint: details.actionableHint,
      };
    }

    case MisalignmentRuleType.DEPENDENCY: {
      if (details.blockerPriority === undefined || details.childPriority === undefined) {
        return {
          title: 'Dependency Priority Check',
          description: 'Unable to determine priorities for comparison.',
        };
      }

      const childLabel = priorityLabels[details.childPriority];
      const blockerLabel = priorityLabels[details.blockerPriority];

      return {
        code: ExplanationCodes.DEPENDENCY_CHILD_LOWER,
        title: 'Blocker Priority Too Low',
        description: `Blocked task priority (${childLabel}) is LOWER than its blocker (${blockerLabel})`,
        hint: details.actionableHint,
      };
    }

    default:
      return {
        title: 'Priority Check',
        description: `Unknown misalignment type: ${type}`,
      };
  }
}

/**
 * Format the explanation for display
 */
export function formatExplanation(check: TaskMisalignmentCheck): string {
  const explanation = getExplanation(check.type, check.details);
  if (!explanation) return 'Priority misalignment detected';

  return explanation.description;
}

/**
 * Get the hint for an explanation
 */
export function getExplanationHint(check: TaskMisalignmentCheck): string | undefined {
  const explanation = getExplanation(check.type, check.details);
  return explanation?.hint;
}