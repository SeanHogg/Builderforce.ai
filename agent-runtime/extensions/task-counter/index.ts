import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { createTaskCounterTool } from "./src/task-counter-tool.js";

export default function register(api: BuilderForceAgentsPluginApi) {
  api.registerTool(createTaskCounterTool(api) as unknown as AnyAgentTool, {
    optional: true,
    version: "1.0.0",
  });
}