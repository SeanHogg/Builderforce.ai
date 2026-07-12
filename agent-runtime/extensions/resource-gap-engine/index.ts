import { Type } from "@seanhogg/builderforce-agents/plugin-sdk";
import { createResourceGapTool } from "./src/tool.js";

export function register(api) {
  api.registerTool(createResourceGapTool(api), { optional: true });
}