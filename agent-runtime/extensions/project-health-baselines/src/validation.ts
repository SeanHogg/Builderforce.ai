/**
 * Validation rules for baseline creation and updates (PRD #294)
 */

import {
  ValidationViolation,
  BaselineMetadata,
  BaselineContent,
  BaselineAuthor,
  ResponseMetadataCore,
  BaselineVersion
} from "./types.js";

/**
 * Validate response length (AC-1 token guard: up to ~10,000 tokens)
 */
export function validateResponseLength(responseText: string): ValidationViolation[] {
  const errors: ValidationViolation[] = [];
  // Slightly under the 10k token limit to allow ~10% overhead (approx. 9.5k tokens)
  const MAX_LENGTH = 9500;
  if (responseText.length > MAX_LENGTH) {
    errors.push({
      violation: "response_text_too_large",
      message: `Response length ${responseText.length} exceeds maximum of ${MAX_LENGTH} characters (~10k tokens) for AC-1 token guard.`
    });
  }
  return errors;
}

/**
 * Validate required non-optional fields
 */
export function validateRequiredNonOptionalFields(
  name: string,
  responseText: string,
  metadata: BaselineMetadata,
  author: BaselineAuthor
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  if (!name || name.trim().length === 0) {
    violations.push({
      violation: "baseline_name_missing",
      message: "Baseline name is required."
    });
  }

  if (!responseText || responseText.trim().length === 0) {
    violations.push({
      violation: "response_text_missing",
      message: "Response text is required."
    });
  }

  const required = ["projectId", "streamName", "baselineName", "responseMetadata", "author"] as const;
  for (const field of required) {
    const value = (metadata as Record<string, unknown>)[field];
    if (!value) {
      violations.push({
        violation: `metadata_${field}_missing`,
        message: `Metadata.${field} is required.`
      });
    }
  }
  // Disallow empty author (userId must be present)
  if (!author.userId || author.userId.trim().length === 0) {
    violations.push({
      violation: "author_user_id_missing",
      message: "Author.userId is required."
    });
  }

  return violations;
}

/**
 * Validate immutable fields (AC-2 immutability)
 */
export function validateImmutableFields(
  current: Pick<Baseline, "content" | "metadata" | "author">,
  newName?: string,
  newDescription?: string,
  newTags?: string[]
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // Core content fields immutable
  if (current.content) {
    if (current.content.responseText !== undefined) {
      violations.push({
        violation: "immutable_response_text",
        message:
          "content.responseText cannot be edited after baseline creation (AC-2)."
      });
    }
    if (
      current.content.responseMetadata.model !== undefined ||
      current.content.responseMetadata.timestamp !== undefined ||
      current.content.responseMetadata.contextMode !== undefined
    ) {
      violations.push({
        violation: "immutable_core_metadata",
        message:
          "content.responseMetadata fields (model, timestamp, contextMode) cannot be edited."
      });
    }
  }

  // Metadata fields immutable (projectId, streamName, baselineName)
  if (current.metadata) {
    const m = current.metadata;
    const alwaysImmutable = ["projectId", "streamName", "baselineName"] as const;
    for (const field of alwaysImmutable) {
      const val = (m as Record<string, unknown>)[field];
      if (val !== undefined) {
        violations.push({
          violation: `immutable_metadata_${field}`,
          message: `metadata.${field} (projectId, streamName, baselineName) cannot be edited.`
        });
      }
    }
  }

  // Core author subsets immutable (userId, userName)
  if (current.author) {
    const a = current.author;
    [a.userId, a.userName].forEach((val) => {
      if (val !== undefined) {
        violations.push({
          violation: "immutable_author",
          message: "Author.userId or userName cannot be edited."
        });
      }
    });
  }

  return violations;
}

/**
 * Validate baseline version constraints
 */
export function validateVersion(baselineVersion: BaselineVersion): boolean {
  return ["v1", "v2", "v3", "v4"].includes(baselineVersion);
}

/**
 * Validation result wrapper
 */
export interface ValidationViolation {
  violation: string;
  message: string;
}

/**
 * Validation outcome
 */
export interface ValidationOutcome {
  valid: boolean;
  violations: ValidationViolation[];
}

/**
 * Convenience: combine multiple validation concerns in one pass
 */
export function validateBaselineCreation(
  name: string,
  responseText: string,
  metadata: BaselineMetadata,
  author: BaselineAuthor
): ValidationOutcome {
  const violations: ValidationViolation[] = [
    ...validateRequiredNonOptionalFields(name, responseText, metadata, author),
    ...validateResponseLength(responseText)
  ];

  return { valid: violations.length === 0, violations };
}

/**
 * Helper for error case handling during immutability validation (when a snapshot is missing)
 */
function impossible(state: string): never {
  throw new Error(`Invariant failure during immutability validation: ${state}.`);
}

/**
 * Idempotent immutability check: returns violations if ANY immutable fields are present in the provided partial.
 * This protects baseline.create (pre-save validation) and baseline.update (post-create error fallback).
 */
export function validateImmutableFieldsSafe(
  partial: Pick<Partial<Baseline>, "content" | "metadata" | "author">
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  const hasContent = partial.content !== undefined;
  const hasMetadata = partial.metadata !== undefined;
  const hasAuthor = partial.author !== undefined;

  // Validate content
  if (hasContent) {
    if ("responseText" in partial.content) {
      violations.push({ violation: "immutable_response_text", message:
        "content.responseText cannot be edited after baseline creation (AC-2)." });
    }
    if ("responseMetadata" in partial.content) {
      const m = partial.content.responseMetadata!;
      if ("model" in m) violations.push({ violation: "immutable_core_metadata", message:
        "content.responseMetadata.model cannot be edited." });
      if ("timestamp" in m) violations.push({ violation: "immutable_core_metadata", message:
        "content.responseMetadata.timestamp cannot be edited." });
      if ("contextMode" in m) violations.push({ violation: "immutable_core_metadata", message:
        "content.responseMetadata.contextMode cannot be edited." });
    }
  }

  // Validate metadata
  if (hasMetadata) {
    const md = partial.metadata;
    const immutableProjectFields = ["projectId", "streamName", "baselineName"];
    for (const field of immutableProjectFields) {
      if (field in md) {
        violations.push({ violation: "immutable_metadata_core", message:
          `metadata.${field} cannot be edited.` });
      }
    }
  }

  // Validate author
  if (hasAuthor) {
    const a = partial.author;
    if ("userId" in a) {
      violations.push({ violation: "immutable_author", message:
        "Author.userId cannot be edited." });
    }
    if ("userName" in a) {
      violations.push({ violation: "immutable_author", message:
        "Author.userName cannot be edited." });
    }
  }

  return violations;
}