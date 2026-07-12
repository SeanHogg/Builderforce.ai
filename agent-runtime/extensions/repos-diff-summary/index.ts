import type { BuilderForceAgentsPluginApi } from "../src/plugins/types.js";
import { createReposDiffSummaryTool } from "./src/tool.js";

/**
 * Register the PR/Branch diff summary tool.
 *
 * The extension provides the MCP tool `repos.pull_request_diff_summary` that:
 * - Accepts taskId (or prNumber + projectId / branchName + projectId)
 * - Returns a categorized file-change summary (source-code | test | docs | config | migration | asset)
 * - Includes derived booleans: codeChanged, docsOnly, testsChanged, configOnly
 * - Supports per-repository CSS override via .mcp-diff-categories.yml
 * - Caches results per (prNumber, headSha) for 60s (configurable)
 *
 * Example tool invocation:
 * ```
 * repos.pull_request_diff_summary({ taskId: "task-1" })
 * ```
 */
export default function register(api: BuilderForceAgentsPluginApi) {
  api.registerTool(createReposDiffSummaryTool(api), { optional: false });
}