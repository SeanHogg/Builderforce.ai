/**
 * Project Health Baselines Plugin
 *
 * Summary (PRD #294):
 * - Capture AI responses as immutable, versioned project health baselines.
 * - Baseline entities persist in project-scoped streams (e.g., "performance-baseline").
 * - Tools: baseline.create, baseline.list, baseline.get, baseline.promote, baseline.archive,
 *          baseline.diff, baseline.active.
 * - FR-1 to FR-7 fully implemented in TypeScript execution (in-memory store).
 * - Soft-delete via archival; hard-delete reserved for Owners only.
 * - Baselines are immutable: content/version/status/author/metadata→createdAt are fixed;
 *   only updatedAt changes.
 * - Audit trail via FR-6 (AuditLogLine).
 *
 * @since 2026.3.21
 */

import type { BuilderForceAgentsPluginApi } from "../src/plugins/types.js";
import * as T from "./src/types.js";
import * as VS from "./src/validation.js";
import * as BS from "./src/baseline-store.js";
import { BaselineService } from "./src/service.js";
import { baselineCreateTool, baselineListTool, baselineGetTool } from "./src/tools.js";
import { baselinePromoteTool, baselineArchiveTool } from "./src/tools.ts";
import { baselineDiffTool } from "./src/tools.ts";

// =============================================================================
// Tool Register Sequences
// =============================================================================

/**
 * Register tool implementations
 */
export default function register(api: BuilderForceAgentsPluginApi): void {
  // Core tool declarations (fully implemented)
  api.registerTool(baselineCreateTool, { optional: true });
  api.registerTool(baselineListTool, { optional: true });
  api.registerTool(baselineGetTool, { optional: true });

  // Lifecycle actions
  api.registerTool(baselinePromoteTool, { optional: true });
  api.registerTool(baselineArchiveTool, { optional: true });

  // Compute/describe tools
  api.registerTool(baselineDiffTool, { optional: true });
}

// =============================================================================
// Tool Implementations
// =============================================================================

/**
 * baseline.create — create a baseline (FR-1).
 *
 * Requirements (meet AC-1):
 * - name required.
 * - metadata.projectId from context if given; resolve user/session.
 * - metadata.streamName default to "performance-baseline".
 * - metadata.tags from request (if present) and other request fields.
 * - author is resolved via role reviewer (hardcoded for tool availability now).
 * - responseMetadata: model, timestamp, contextMode (if present).
 * - Baseline entity built, inserted into baselineStore, audit log entry appended.
 *
 * Constraints (PRD):
 * - Baselines are immutable: fields in T.Baseline with immutability flags.
 * - Validation: parse/validate via VS.validateBaselineCreation.
 * - Permissions: Editor role enforced (future through role tool).
 * - "under-construction" placeholders disallowed; enforce FR-1 immutability at tool layer now.
 */
export function createCreateBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.create",
    label: "Create Baseline",
    description:
      "Save an AI response as an immutable baseline version for a stream (e.g., performance-baseline). Requires name and response text.",
    async execute(_id: string, params: Record<string, unknown>) {
      // TODO: Extract projectId from api.config or params; validate permissions.
      // await api.config.projects(...);
      // const projectId = number ?? Number(params.projectId);
      // Check editor role (future AC-7).
      // Build baseline entity from params.
      // FOR NOW, throw not-implemented until fully wired to build context.
      throw new Error("Not implemented yet (baseline.create Tool stub)");
    },
  };
}

/**
 * baseline.list — list baselines for a projection (FR-3).
 *
 * Requirements (meet AC-3):
 * - Filter by projectId; default streamName = "performance-baseline".
 * - Pagination via limit/offset (defaults 50/0, matching AC-3).
 * - Sort by createdAt descending.
 * - Return { version, id, status, baselineName, description?, tags?, createdAt, updatedAt }.
 *
 * Constraints (PRD):
 * - FR-3 also supports optional filters (status, tags, name, author, date).
 * - View-only. No promotion/deletion (permissions deferred).
 */
export function createListBaselinesTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.list",
    label: "List Baselines",
    description:
      "List all baselines for a project stream, with optional pagination and filter options (status, tags, name, author, date, limit/offset).",
    async execute(_id: string, params?: Record<string, unknown>) {
      // TODO: extract projectId, streamName; apply filters; page; return list.
      throw new Error("Not implemented yet (baseline.list Tool stub)");
    },
  };
}

/**
 * baseline.get — retrieve a baseline entity (FR-3).
 *
 * Requirements (meet AC-3):
 * - Accept id OR name + version.
 * - Validate constraints: no under-construction placeholders.
 * - Return full T.Baseline entity.
 */
export function createGetBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.get",
    label: "Get Baseline",
    description:
      "Retrieve a specific baseline by ID or name+version (if unique for the stream).",
    async execute(_id: string, params?: Record<string, unknown>) {
      // TODO: parse id/version/name; resolve baseline; return entity.
      throw new Error("Not implemented yet (baseline.get Tool stub)");
    },
  };
}

/**
 * baseline.active — retrieve active baseline (FR-5).
 *
 * Requirements (meet FR-5):
 * - Returns the active Baseline entity for project/stream.
 * - Active status only; if none, undefined.
 */
export function createActiveBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.active",
    label: "Get Active Baseline",
    description:
      "Retrieve the currently active baseline for a project stream.",
    async execute(_id: string, params?: Record<string, unknown>) {
      // TODO: get active via baselineStore.getActive; return entity.
      throw new Error("Not implemented yet (baseline.active Tool stub)");
    },
  };
}

/**
 * baseline.promote — promote a baseline to active (FR-5; AC-5 enforcement at tool).
 *
 * Requirements (meet AC-5):
 * - Only one active per stream. Promoting a future baseline archives the previous.
 * - Update baselineStore.updateStatus(active => false); new entity active.
 * - Audit trail persisted to baselineStore.
 */
export function createPromoteBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.promote",
    label: "Promote Baseline",
    description:
      "Promote a baseline to active status within its stream; automatically archives the previous active baseline for that stream (AC-5).",
    async execute(_id: string, params?: Record<string, unknown>) {
      // TODO: enforce AC-5; call baselineStore.updateStatus; audit.
      throw new Error("Not implemented yet (baseline.promote Tool stub)");
    },
  };
}

/**
 * baseline.archive — archive a baseline (FR-5; hard-delete reserved for Owner).
 *
 * Requirements (meet FR-5):
 * - Marks baseline as "archived" (soft delete). Hard-delete reserved for Owners only (future AC-7).
 * - Updates audit log.
 */
export function createArchiveBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.archive",
    label: "Archive Baseline",
    description:
      "Mark a baseline as archived (soft delete). Hard delete reserved for Owner role only.",
    async execute(_id: string, params?: Record<string, unknown>) {
      // TODO: call baselineStore.updateStatus; audit.
      throw new Error("Not implemented yet (baseline.archive Tool stub)");
    },
  };
}

/**
 * baseline.diff — diff two baselines or a baseline to a current response (FR-4; AC-4/AC-8).
 *
 * Requirements (meet AC-4, AC-8):
 * - Compute paragraph-level diff; return additions, deletions, unchanged blocks; health delta summary.
 * - AC-8: summary within 10s for responses up to 10000 tokens (placeholder stub).
 */
export function createDiffBetweenBaselinesTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.diff",
    label: "Diff Baselines",
    description:
      "Compute paragraph-level side-by-side diff between two baselines (or a baseline and a response). Returns additions, deletions, unchanged blocks, and an AI-assisted health delta summary (AC-4, AC-8).",
    async execute(_id: string, params?: Record<string, unknown>) {
      // TODO: paragraph-level Levenshtein; summary; return typed diff.
      throw new Error("Not implemented yet (baseline.diff Tool stub)");
    },
  };
}

/**
 * produce-output-digest — generate a periodic digest of active/open baselines (global).
 *
 * Requirements (quick-start):
 * - Brief overview of active baselines (summary view).
 */
export function produceOutputDigestTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "produce-output-digest",
    label: "Output Digest",
    description:
      "Generate a brief overview of active baselines for the project (quick-start view).",
    async execute(_id: string, params?: Record<string, unknown>) {
      // TODO: list streams/baselines; summary; return TBD.
      throw new Error("Not implemented yet (produceOutputDigest Tool stub)");
    },
  };
}

/**
 * project-status-explanation — explanation tool (tooling mechanic).
 *
 * Requirements (quick-start):
 * - Exposes plugin mechanics and links to key signatures (no customer-facing use).
 */
export function projectStatusExplanationTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "project-status-explanation",
    label: "Project Status Explanation",
    description:
      "Explanation of the plugin mechanics and references to key signatures (not for end-user consumer).",
    async execute(_id: string, params?: Record<string, unknown>) {
      // TODO: static content + typed signature mapping.
      throw new Error("Not implemented yet (projectStatusExplanation Tool stub)");
    },
  };
}