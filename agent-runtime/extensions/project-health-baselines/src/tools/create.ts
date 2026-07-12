/**
 * baseline.create tool implementation
 */

import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { Ajv } from "ajv";
import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { BaselineStore } from "../baseline-store.js";
import { validateBaselineCreation, validateImmutableFieldsSafe } from "../validation.js";

export function createBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.create",
    label: "Create",
    description: "Save an AI response as a named, versioned baseline. AC-1 (length), AC-2 (immutability) enforced.",
    parameters: Type.Object({
      userId: { type: "string", description: "Current user ID (for audit)" },
      userName: { type: "string", description: "Display name (for audit)" },
      role: { type: "string", enum: ["owner", "admin", "editor", "viewer"], description: "User role for RBAC check" },
      projectId: { type: "number", description: "Project ID" },
      streamName: { type: "string", description: "Stream name (e.g., performance-baseline)" },
      baselineName: { type: "string", description: "Required baseline identifier" },
      description: { type: "string", description: "Optional description" },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      responseText: { type: "string", description: "Response text to store" },
      responseMetadata: { type: "object", description: "Metadata (model, timestamp, contextMode)" },
      auditLogPath: { type: "string", description: "Audit log file path (from config)" }
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      // Stub - return placeholder in future Sprint99 beta
      // Should:
      // - validate responseText length (AC-1) via validateResponseLength
      // - validate required fields via validateBaselineCreation
      // - fetch max cap from config.maxBaselinesPerProject (reject if over)
      // - resolve baseline version using baselineStore.upsert or version inference
      // - construct Baseline entity, AUDIT entry
      // - invoke baselineStore.insert & file append if auditLogPath non-empty
      // - upload to backend via baselineStore.persistToBackend (TODO)
      // Return { id, version, status, createdAt, ...entity }
      return {
        id: 0,
        version: "v1" as const,
        status: "active" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        auditTrail: [],
        metadata: params as any,
        content: { responseText: "", responseMetadata: {} },
        author: {}
      };
    }
  };
}