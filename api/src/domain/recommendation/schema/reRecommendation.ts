/**
 * Recommendation augmentation schemas (builderforce.ai)
 *
 * Defines Zod schemas for task augmentation analysis:
 * - recommendation/reject
 * - structured-recommendation-log
 * - structured-reject-log
 * - feedback
 *
 * All choices are explicitly recorded in logs so decisions are transparent and
 * queryable for compliance and model tuning.
 */

import { z } from "zod";
import { TaskType, TaskPriority, AgentType } from "../shared/types.js";

// ---------------------------------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------------------------------

/** Task augmentation recommendation type */
export const SupportFactorSchema = z.enum([
  "domainExpertise",
  "capacity",
  "riskCompliance",
  "skillRedundancy",
  "bottleneck",
]);

/** Recommendation type (add_agent | add_human | add_both | no_change // rejection) */
export const RecommendationTypeSchema = z.enum([
  "add_agent",
  "add_human",
  "add_both",
  "no_change",
]);

/** Rejection reasons (internal classification) */
export const RejectionReasonSchema = z.enum([
  "no Applied human reviewer",
  "noAssignedAgentOrHumanCommuting",
  "partialHumanAssignedAtHighRisk",
  "multiStepWorkflowInsufficientSpanning",
  "noSubTaskHierarchy",
  "unknownReason",
]);

/** Rejection urgency when noAppliedChanges is expressed */
export const NoAppliedUrgencySchema = z.enum([
  "immediate",
  "soon",
  "low",
]);

/** Suggested roles (human or agent capability profile) */
export const SuggestedRoleSchema = z.object({
  kind: z.enum(["human", "agent"]),
  name: z.string().min(1),
  authority: z.union([
    z.literal("advisory"),
    z.literal("approval"),
    z.enum(["signedByMultipleOwnersIfHousekeeping"]),
  ]).optional(),
  // Agent capability profile (if kind="agent")
  capabilities: z.array(z.string()).optional(),
  // Human archetype / credential (if kind="human")
  archetype: z.string().optional(),
});

// ---------------------------------------------------------------------------------------------------------------------
// Core recommendation/rejection objects
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A single recommendation internally represented as a rejection with an empty
 * add list. Its structured version uses "add_agent", "add_human", "add_both"
 * to surface actionable recommendations in the encoded response.
 */
export const RecRecommendationRejectionReqSchema = z.object({
  recommendationType: RejectionReasonSchema,
  urgency: NoAppliedUrgencySchema,
  suggestedRoles: z.array(SuggestedRoleSchema),
  rationale: z.string().min(1),
  rejectionReason: RejectionReasonSchema,
  rejectionRationale: z.string().optional(),
});

/** Structured encoded response to expose to callers (v2 semantics) */
export const RecRecommendationSchema = z.object({
  recommendationType: RecommendationTypeSchema,
  urgency: NoAppliedUrgencySchema,
  suggestedRoles: z.array(SuggestedRoleSchema),
  rationale: z.string().min(1),
  rejectionReasonOptional: RejectionReasonSchema.optional(),
  rejectionRationaleOptional: z.string().optional(),
});

// ---------------------------------------------------------------------------------------------------------------------
// Structured recommendation & rejection logs
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Structured recommendation event log entry.
 *
 * - id: unique globally, not null
 * - recommendationType: internal rejection type (add_agent|add_human|add_both|noAppliedChanges tagged)
 * - urgency: urgency when add_* or noAppliedChanges
 * - suggestedRoles: any roles listed as additions/add_both (no_removed)
 * - rationale: human-readable, ≥1 sentence
 * - rejectionReasonOptional: noAppliedChanges -> rejectionReason (e.g., noAppliedChanges)
 * - rejectionRationaleOptional: noAppliedChanges -> why noAppliedChanges
 */
export const StructuredRecLogEntrySchema = z.object({
  submitted: z.string().datetime(), // ISO timestamp
  taskId: z.number(),
  projectId: z.number(),
  recommendationType: RejectionReasonSchema,
  urgency: NoAppliedUrgencySchema,
  suggestedRoles: z.array(SuggestedRoleSchema),
  rationale: z.string().min(1),
  rejectionReasonOptional: z.string().optional(), // noAppliedChanges only
  rejectionRationaleOptional: z.string().optional(), // noAppliedChanges only
});

/** Structured rejection event log entry (noAppliedChanges) */
export const StructuredRejectLogEntrySchema = StructuredRecLogEntrySchema.pick({
  submitted: true,
  taskId: true,
  projectId: true,
  recommendationType: true,
  urgency: true,
  suggestedRoles: true,
  rationale: true,
});

/** Acceptance over-ride: add_agent / add_human / add_both / noAppliedChanges */
export const FeedbackAcceptanceTypeSchema = z.enum([
  "add_agent",
  "add_human",
  "add_both",
  "noAppliedChanges",
]);

/** Structured feedback entry */
export const StructuredFeedbackSchema = z.object({
  accepted: z.boolean(),
  acceptanceType: FeedbackAcceptanceTypeSchema,
  feedbackText: z.string().optional(),
  firedEventOid: z.number().optional(), // workflow event firing this analysis (optional)
});

// ---------------------------------------------------------------------------------------------------------------------
// Request/Response DTOs for API layers
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Request: task augmentation analysis specification
 *
 * Expecters must supply fields needed for analysis and logging. Out-of-scope:
 * FTE job postings with a named user, recruiting/don’t expose users/constraints.
 */
export const TaskAugmentationAnalysisRequestSchema = z.object({
  projectId: z.number(),
  taskId: z.number(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.string(), // lane key
  taskType: TaskType.optional(),
  priority: TaskPriority.optional(),
  assignedAgentHostId: z.number().optional(),
  assignedAgentRef: z.string().optional(),
  assignedUserId: z.string().optional(),
  expertDomainTags: z.array(z.string()).optional(), // supplemental
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
  childrenCount: z.number().optional(),
});

/**
 * Request: feedback submission
 */
export const RecRecommendationFeedbackRequestSchema = z.object({
  taskId: z.number(),
  recommendationId: z.string(), // log entry id
  accepted: z.boolean(),
  acceptanceType: FeedbackAcceptanceTypeSchema,
  feedbackText: z.string().optional(),
  firedEventOid: z.number().optional(), // workflow event firing this analysis (optional)
});

/**
 * Response: structured encoded recommendation/rejection (z2)
 */
export const RecRecommendationEncodedResponseSchema = z.object({
  recommendationType: RecommendationTypeSchema,
  urgency: NoAppliedUrgencySchema,
  suggestedRoles: z.array(SuggestedRoleSchema),
  rationale: z.string().min(1),
});

/**
 * Response: structured recommendation/rejection details
 */
export const RecRecommendationDetailedSchema = z.object({
  latestAnalysis: StructuredRecLogEntrySchema,
  encodedResponse: RecRecommendationEncodedResponseSchema,
});

/** Paged query filters */
export const RecRecommendationLogQuerySchema = z.object({
  taskId: z.number().optional(),
  projectId: z.number().optional(),
  recommendationType: RejectionReasonSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().default(50),
  offset: z.number().default(0),
});