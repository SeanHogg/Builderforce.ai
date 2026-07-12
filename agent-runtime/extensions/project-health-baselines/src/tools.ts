/**
 * Baseline tools: tools.ts (PRD #294)
 * implements { toolId, toolName, parameters: Type.Object<...>, execute }
 */
import { Type } from "@builderforce/agent-tools";
import { ToolInputError } from "@builderforce/agent-tools";
import { BaselineService } from "./service.js";

/**
 * Tool: baseline.create
 */
export const baselineCreateTool = {
  toolId: "baseline.create",
  toolName: "baseline.create",
  description: "Save AI responses as an immutable project health baseline.",
  parameters: Type.Object({
    name: { type: "string", description: "Baseline name (required)" },
    description: { type: "string", description: "Optional description" },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Optional tags"
    },
    responseText: {
      type: "string",
      description: "Full AI response text (required)"
    },
    responseMetadata: {
      type: "object",
      description: "Response metadata (model, timestamp, contextMode)"
    },
    projectId: { type: "number", description: "Project ID (required)" },
    streamName: {
      type: "string",
      description: "Stream name (required; e.g. performance, security)"
    },
    author: {
      type: "object",
      description: "Author identity (required)"
    }
  }),
  execute: async (
    _id: string,
    params: {
      name: string;
      description?: string;
      tags?: string[];
      responseText: string;
      responseMetadata: Record<string, unknown>;
      projectId: number;
      streamName: string;
      author: Record<string, unknown>;
    },
    service: BaselineService
  ) => {
    try {
      const baseline = await service.create(params);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(baseline, null, 2)
        }],
        details: {
          toolInvocation: "baseline.create",
          baselineId: baseline.id,
          version: baseline.version,
          streamName: baseline.metadata.streamName,
          status: baseline.status
        }
      };
    } catch (err) {
      if (err instanceof ToolInputError) {
        throw err;
      }
      throw new ToolInputError(`Failed to create baseline: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
};

/**
 * Tool: baseline.list
 */
export const baselineListTool = {
  toolId: "baseline.list",
  toolName: "baseline.list",
  description: "List baselines for a project with filters.",
  parameters: Type.Object({
    projectId: { type: "number", description: "Project ID (required)" },
    streamName: { type: "string", description: "Optional stream name filter" },
    status: { type: "string", description: "Optional status filter" },
    tags: { type: "string", description: "Optional tag filter" },
    name: { type: "string", description: "Optional name filter" },
    author: { type: "string", description: "Optional author filter" },
    fromDate: { type: "string", description: "Optional start date ISO string" },
    toDate: { type: "string", description: "Optional end date ISO string" },
    limit: { type: "number", description: "Page size (default 50)" },
    offset: { type: "number", description: "Page offset (default 0)" }
  }),
  execute: async (
    _id: string,
    params: {
      projectId: number;
      streamName?: string;
      status?: string;
      tags?: string;
      name?: string;
      author?: string;
      fromDate?: string;
      toDate?: string;
      limit?: number;
      offset?: number;
    },
    service: BaselineService
  ) => {
    try {
      const baselines = await service.list(params);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(baselines, null, 2)
        }],
        details: {
          toolInvocation: "baseline.list",
          count: baselines.length
        }
      };
    } catch (err) {
      if (err instanceof ToolInputError) {
        throw err;
      }
      throw new ToolInputError(`Failed to list baselines: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
};

/**
 * Tool: baseline.get
 */
export const baselineGetTool = {
  toolId: "baseline.get",
  toolName: "baseline.get",
  description: "Retrieve a specific baseline by ID or name.",
  parameters: Type.Object({
    id: { type: "string", description: "Extension ID (required)" },
    projectId: { type: "number", description: "Project ID (required)" },
    streamName: { type: "string", description: "Optional stream name filter" },
    idOrName: { type: "string", description: "ID (number) or name (string)" },
    version: { type: "string", description: "Optional version identifier v1/v2/..." }
  }),
  execute: async (
    _id: string,
    params: {
      id: string;
      projectId: number;
      streamName?: string;
      idOrName?: string;
      version?: string;
    },
    service: BaselineService
  ) => {
    try {
      const baseline = await service.get(params);
      if (!baseline) {
        throw new ToolInputError("Baseline not found.");
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify(baseline, null, 2)
        }],
        details: {
          toolInvocation: "baseline.get",
          baselineId: baseline.id
        }
      };
    } catch (err) {
      if (err instanceof ToolInputError) {
        throw err;
      }
      throw new ToolInputError(`Failed to get baseline: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
};

/**
 * Tool: baseline.promote
 */
export const baselinePromoteTool = {
  toolId: "baseline.promote",
  toolName: "baseline.promote",
  description: "Promote a baseline to active status; automatically archiving existing active baselines in the same stream.",
  parameters: Type.Object({
    id: { type: "string", description: "Extension ID (required)" },
    projectId: { type: "number", description: "Project ID (required)" },
    streamName: { type: "string", description: "Stream name (required)" },
    version: { type: "string", description: "Optional version identifier v1/v2/... (defaults to latest)" },
    author: { type: "object", description: "Author identity (required)" }
  }),
  execute: async (
    _id: string,
    params: {
      id: string;
      projectId: number;
      streamName: string;
      version?: string;
      author: Record<string, unknown>;
    },
    service: BaselineService
  ) => {
    try {
      const baseline = await service.promote(params);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(baseline, null, 2)
        }],
        details: {
          toolInvocation: "baseline.promote",
          baselineId: baseline.id,
          version: baseline.version,
          status: baseline.status
        }
      };
    } catch (err) {
      if (err instanceof ToolInputError) {
        throw err;
      }
      throw new ToolInputError(`Failed to promote baseline: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
};

/**
 * Tool: baseline.archive
 */
export const baselineArchiveTool = {
  toolId: "baseline.archive",
  toolName: "baseline.archive",
  description: "Archive a baseline (non‑destructive).",
  parameters: Type.Object({
    id: { type: "string", description: "Extension ID (required)" },
    projectId: { type: "number", description: "Project ID (required)" },
    streamName: { type: "string", description: "Stream name (required)" },
    version: { type: "string", description: "Optional version identifier v1/v2/..." },
    author: { type: "object", description: "Author identity (required)" }
  }),
  execute: async (
    _id: string,
    params: {
      id: string;
      projectId: number;
      streamName: string;
      version?: string;
      author: Record<string, unknown>;
    },
    service: BaselineService
  ) => {
    try {
      const baseline = await service.archive(params);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(baseline, null, 2)
        }],
        details: {
          toolInvocation: "baseline.archive",
          baselineId: baseline.id,
          status: baseline.status
        }
      };
    } catch (err) {
      if (err instanceof ToolInputError) {
        throw err;
      }
      throw new ToolInputError(`Failed to archive baseline: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
};

/**
 * Tool: baseline.active
 */
export const baselineActiveTool = {
  toolId: "baseline.active",
  toolName: "baseline.active",
  description: "Get the active baseline (latest in status === 'active') for a stream.",
  parameters: Type.Object({
    id: { type: "string", description: "Extension ID (required)" },
    projectId: { type: "number", description: "Project ID (required)" },
    streamName: { type: "string", description: "Stream name (required)" }
  }),
  execute: async (
    _id: string,
    params: {
      id: string;
      projectId: number;
      streamName: string;
    },
    service: BaselineService
  ) => {
    try {
      const baseline = await service.active(params);
      if (!baseline) {
        throw new ToolInputError("No active baseline found in this stream.");
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify(baseline, null, 2)
        }],
        details: {
          toolInvocation: "baseline.active",
          baselineId: baseline.id,
          streamName: baseline.metadata.streamName
        }
      };
    } catch (err) {
      if (err instanceof ToolInputError) {
        throw err;
      }
      throw new ToolInputError(`Failed to get active baseline: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
};

/**
 * Tool: baseline.diff
 */
export const baselineDiffTool = {
  toolId: "baseline.diff",
  toolName: "baseline.diff",
  description: "Compute paragraph-level diff and health delta summary between two baselines.",
  parameters: Type.Object({
    id: { type: "string", description: "Extension ID (required)" },
    baselineId1: { type: "number", description: "Baseline ID (first)" },
    baselineId2: { type: "number", description: "Baseline ID (second)" },
    host: { type: "string", description: "Current host (required)" },
    traceId: { type: "string", description: "Optional trace ID" }
  }),
  execute: async (
    _id: string,
    params: {
      id: string;
      baselineId1: number;
      baselineId2: number;
      host: string;
      traceId?: string;
    },
    service: BaselineService
  ) => {
    try {
      const result = await service.diff(params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        details: {
          toolInvocation: "baseline.diff",
          baselineId1: params.baselineId1,
          baselineId2: params.baselineId2,
          deltaSummaryType: result.healthDeltaSummary.summary_type
        }
      };
    } catch (err) {
      if (err instanceof ToolInputError) {
        throw err;
      }
      throw new ToolInputError(`Failed to compute diff: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
};