import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { createResourceGapTool } from "./src/tool.js";

export function register(api: BuilderForceAgentsPluginApi): void {
  api.registerTool(createResourceGapTool(api), { optional: true });
}