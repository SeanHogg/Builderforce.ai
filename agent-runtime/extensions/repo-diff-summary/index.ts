// Plugin entrypoint: register the repo-diff-summary tool.
import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { createRepoDiffSummaryTool } from "./src/repo-diff-summary-tool.js";

/**
 * Registers the new MCP tool for PR/branch diff summaries.
 * The tool will surface on tools/list under name "repos.pull_request_diff_summary".
 *
 * @param api - Host plugin API (provides tool registration, task resolution, git provider).
 */
export default function register(api: BuilderForceAgentsPluginApi): void {
  const tool = createRepoDiffSummaryTool(api);
  api.registerTool(tool as unknown as AnyAgentTool, {
    optional: true,
  });
}