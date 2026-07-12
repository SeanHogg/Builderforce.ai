/**
 * Validation utilities (PRD #294)
 * Replaces broken imports and error declarations.
 */
import { AnyToolError } from "@builderforce/agent-tools";

/**
 * Validation violation type
 */
export interface ValidationViolation {
  propertyPath: string;
  message: string;
  severity: "critical" | "error" | "warning";
}

/**
 * Validate baseline creation inputs
 */
export function validateBaselineCreation(
  name: string,
  responseText: string,
  metadata: Record<string, unknown>,
  author: Record<string, unknown>
): { violations: ValidationViolation[] } {
  const violations: ValidationViolation[] = [];

  if (!name || name.trim().length === 0) {
    violations.push({
      propertyPath: "name",
      message: "Baseline name is required.",
      severity: "error"
    });
  }

  if (!responseText || responseText.trim().length === 0) {
    violations.push({
      propertyPath: "responseText",
      message: "Response text is required.",
      severity: "error"
    });
  }

  if (!metadata || typeof metadata !== "object") {
    violations.push({
      propertyPath: "metadata",
      message: "Metadata is required and must be an object.",
      severity: "error"
    });
  }

  // Check author
  if (!author || typeof author !== "object") {
    violations.push({
      propertyPath: "author",
      message: "Author object is required.",
      severity: "error"
    });
  } else {
    const userId = author.userId;
    if (!userId || typeof userId !== "string") {
      violations.push({
        propertyPath: "author.userId",
        message: "Author.userId is required and must be a string.",
        severity: "object"
      });
    }
    const role = author.role;
    if (!role || !["owner", "admin", "editor", "viewer"].includes(role as string)) {
      violations.push({
        propertyPath: "author.role",
        message: "Author.role must be one of owner/admin/editor/viewer (optional viewer allowed).",
        severity: "warning"
      });
    }
  }

  // Check version
  const versionNumber = metadata.version as string | undefined;
  if (!validateVersion(versionNumber)) {
    violations.push({
      propertyPath: "version",
      message: "Version must be a string like v1/v2/...; omitted if auto-increment is preferred.",
      severity: "warning"
    });
  }

  return { violations };
}

/**
 * Check immutability flags
 */
function validateImmutableFields(metadata: Record<string, unknown>, description?: string, tags?: string[]): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  if (description !== undefined && typeof description === "string") {
    violations.push({
      propertyPath: "immutableFields.description",
      message: "Description must not be modified after creation.",
      severity: "critical"
    });
  }

  if (tags !== undefined) {
    violations.push({
      propertyPath: "immutableFields.tags",
      message: "Tags must not be modified after creation.",
      severity: "critical"
    });
  }

  return violations;
}

/**
 * Validate version string
 */
export function validateVersion(version: string | undefined): boolean {
  if (!version) return true;
  const v = version.split("v").pop() ?? version;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1;
}

/**
 * Raise ToolInputError if violations exist
 */
export function assertNoViolations(violations: ValidationViolation[]): void {
  if (violations.length === 0) return;

  const criticalOrErrors = violations.filter((v) => v.severity === "critical" || v.severity === "error");
  if (criticalOrErrors.length > 0) {
    throw new AnyToolError {
      message: `Validation errors (${criticalOrErrors.length}): ${criticalOrErrors.map((v) => v.message).join("; ")}` 
    };
  }

  // warnings are logged rather than thrown unless harmful
  for (const v of violations) {
    if (v.severity === "warning") {
      console.warn(`[Validation Warning] ${v.propertyPath}: ${v.message}`);
    }
  }
}

/**
 * Export rewrites for Service imports
 */
export { AnyToolError };