import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { registerGithubPrReviewAgent } from "./src/agent.js";

export default function register(api: BuilderForceAgentsPluginApi) {
  registerGithubPrReviewAgent(api);
}
