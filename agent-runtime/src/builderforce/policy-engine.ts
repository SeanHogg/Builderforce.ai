/**
 * Policy Governance Framework
 * 
 * Enables administrators to define and enforce governance policies across workflows.
 * Policies can be applied to entire workflows or specific tasks, and the orchestration
 * engine automatically enforces them during execution.
 */

export type PolicyType = "data-access" | "approval" | "compliance" | "retry-policy" | "timeout";

export interface PolicyCondition {
  /** Type of policy to enforce */
  type: PolicyType;
  /** Condition for when to apply this policy */
  condition: string;
  /** Violation action (alert, fail, modify) */
  action: "alert" | "fail" | "modify";
  /** Message to include in violation alerts (supports ${var} placeholders) */
  message: string;
  /** Optional parameters for special handling */
  parameters?: Record<string, any>;
}

export interface PolicyDefinition {
  /** Unique policy identifier */
  id: string;
  /** Human-readable policy name */
  name: string;
  /** Policy description */
  description: string;
  /** Polices can target a specific role or be global */
  targetRole?: string;
  /** Whether this is a global policy apply to all workflows */
  isGlobal?: boolean;
  /** Active status */
  active: boolean;
  /** When the policy was last updated */
  updatedAt: Date;
}

export interface PolicyViolation {
  /** The policy that was violated */
  policyId: string;
  /** The step/context that triggered violation */
  stepId?: string;
  /** Error message with variables substituted */
  message: string;
  /** Timestamp of violation */
  timestamp: Date;
  /** Severity level */
  severity: "low" | "medium" | "high" | "critical";
}

export class PolicyEngine {
  /** Policy definitions keyed by policy ID */
  private policies = new Map<string, PolicyDefinition & { conditions: PolicyCondition[] }>();

  constructor(policies: (PolicyDefinition & { conditions: PolicyCondition[] })[]) {
    for (const policy of policies) {
      if (policy.id && policy.name && policy.conditions) {
        this.policies.set(policy.id, { ...policy });
      }
    }
  }

  /**
   * Register or update a policy definition
   * 
   * @param policy - Policy definition with conditions
   */
  registerPolicy(policy: PolicyDefinition & { conditions: PolicyCondition[] }): void {
    if (!policy.id || !policy.name || !policy.conditions) {
      throw new Error("Policy must have id, name, and at least one condition");
    }
    this.policies.set(policy.id, { ...policy, updatedAt: new Date() });
  }

  /**
   * Remove a policy by ID
   * 
   * @param policyId - Policy ID to remove
   */
  unregisterPolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  /**
   * Find all active policies, optionally filtered by target role
   * 
   * @param targetRole - Optional role to filter policies for
   * @returns Array of applicable policies
   */
  listActivePolicies(targetRole?: string): (PolicyDefinition & { conditions: PolicyCondition[] })[] {
    return Array.from(this.policies.values())
      .filter((p) => p.active)
      .filter((p) => !targetRole || !p.targetRole || p.targetRole === targetRole);
  }

  /**
   * Apply all relevant policies to a workflow step
   * 
   * This function checks if any conditions are met and records violations.
   * It does not automatically modify the workflow; the caller should decide
   * how to handle violations (alert, fail, or modify).
   * 
   * @param stepId - Identifier of the step being executed
   * @param role - The agent role executing the step
   * @param context - Current workflow context data for condition evaluation
   * @returns Array of policy violations detected (empty if none)
   */
  enforcePolicies(
    stepId: string,
    role: string,
    context: Record<string, any>,
  ): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const applicablePolicies = this.listActivePolicies(role);

    for (const policy of applicablePolicies) {
      for (const condition of policy.conditions) {
        const matches = this.evaluateCondition(condition.condition, context, role);
        if (matches) {
          // Substitute variables in message
          const message = this.substituteMessage(condition.message, {
            policyId: policy.id,
            role,
            stepId,
            ...context,
          });

          violations.push({
            policyId: policy.id,
            stepId,
            message,
            timestamp: new Date(),
            severity: this.determineSeverity(condition),
          });
        }
      }
    }

    return violations;
  }

  /**
   * Evaluate a policy condition against context data
   * 
   * Supports placeholder syntax: ${variable} will be replaced with context values.
   * 
   * @param condition - Condition string to evaluate
   * @param context - Context data for variable substitution
   * @param role - Current agent role for additional context
   * @returns True if the condition evaluates to truthy
   */
  evaluateCondition(condition: string, context: Record<string, any>, role: string): boolean {
    try {
      // Replace ${variable} placeholders
      let evaluated = condition.replace(
        /\$\{([^}]+)\}/g,
        (match, varName) => String(context[varName] ?? role),
      );

      // Parse result safely - treat non-empty, non-null strings as true
      const result = evaluated.trim();
      return result !== "" && result !== "0" && result !== "false" && result !== "null" && result !== "undefined";
    } catch {
      return false;
    }
  }

  /**
   * Substitute variables in policy messages
   * 
   * @param message - Message with ${variable} placeholders
   * @param context - Context data for substitution
   * @returns Message with variables substituted
   */
  substituteMessage(message: string, context: Record<string, any>): string {
    return message.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      const value = context[varName];
      return value !== undefined ? String(value) : varName;
    });
  }

  /**
   * Determine violation severity based on condition type
   * 
   * @param condition - The condition that triggered the violation
   * @returns Severity level
   */
  private determineSeverity(condition: PolicyCondition): "low" | "medium" | "high" | "critical" {
    switch (condition.type) {
      case "timeout":
        return "medium";
      case "retry-policy":
        return "low";
      case "compliance":
        return "high";
      case "data-access":
        return "critical";
      case "approval":
      default:
        return "medium";
    }
  }
}

/**
 * Default policies for PRD analysis workflows
 * 
 * Example: Require Impact Analysis for large PRDs (AC.3)
 */
export const DEFAULT_PRD_ANALYSIS_POLICIES: (PolicyDefinition & { conditions: PolicyCondition[] })[] = [
  {
    id: "check-prd-size",
    name: "PRD Size Check",
    description: "Alert or fail if PRD exceeds a certain size threshold",
    targetRole: "architecture-advisor",
    active: true,
    updatedAt: new Date(),
    conditions: [
      {
        type: "approval",
        condition: "${prdSize} > 20000",
        action: "alert",
        message: "PRD size (${prdSize} chars) exceeds recommended threshold of 20,000 characters. Consider breaking into separate features.",
      },
      {
        type: "approval",
        condition: "${prdSize} > 40000",
        action: "fail",
        message: "PRD size (${prdSize} chars) exceeds critical threshold of 40,000 characters. Large PRDs should be split into focused documents.",
      },
    ],
  },
  {
    id: "enforce-impact-analysis",
    name: "Impact Analysis Enforcement",
    description: "Require Impac Analysis task for large PRDs",
    targetRole: "workflow-engine",
    active: true,
    updatedAt: new Date(),
    conditions: [
      {
        type: "approval",
        condition: "${prdSize} > 20000 and ${enableImpactAnalysis}",
        action: "modify",
        message: "PRD exceeds 20,000 characters. Enforcing Impact Analysis step for cross-functional impact assessment.",
      },
    ],
  },
  {
    id: "data-access-validation",
    name: "Data Access Validation",
    description: "Ensure tasks requesting data access follow governance rules",
    targetRole: null, // Global policy
    isGlobal: true,
    active: false, // Disabled by default
    updatedAt: new Date(),
    conditions: [
      {
        type: "compliance",
        condition: "${requestDataAccess} and not ${dataAccessCompliant}",
        action: "alert",
        message: "Data access request not compliant with governance policy. Requires approval from data steward.",
      },
    ],
  },
];