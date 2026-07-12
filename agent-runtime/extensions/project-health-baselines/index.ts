/**
 * Project Health Baselines extension entry point
 *
 * Registers baseline tools (baseline.create, baseline.list, baseline.get, baseline.promote, baseline.archive, baseline.diff, baseline.active).
 * Provides in-memory store, configuration schema, and RBAC enforcement per PRD #294.
 */

import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { createBaselineTool } from "./src/tools/create.js";
import {
  listBaselinesTool,
  getBaselineTool,
  promoteBaselineTool,
  archiveBaselineTool,
  diffBetweenBaselinesTool,
  getActiveBaselineTool
} from "./src/tools/index.js";
import { registerConfigSchema } from "./src/config-schema.js";
import { registerRBAC } from "./src/rbac.js";

export default function register(api: BuilderForceAgentsPluginApi): void {
  // Register configuration schema
  registerConfigSchema(api);

  // Register RBAC policies
  registerRBAC(api);

  // Register tools
  const tools: AnyAgentTool[] = [
    createBaselineTool(api),
    listBaselinesTool(api),
    getBaselineTool(api),
    promoteBaselineTool(api),
    archiveBaselineTool(api),
    diffBetweenBaselinesTool(api),
    getActiveBaselineTool(api)
  ];

  for (const tool of tools) {
    api.registerTool(tool, { optional: true });
  }
}