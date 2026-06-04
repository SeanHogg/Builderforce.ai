import type { BuilderForceAgentsConfig } from "../config/config.js";

export function applyOnboardingLocalWorkspaceConfig(
  baseConfig: BuilderForceAgentsConfig,
  workspaceDir: string,
): BuilderForceAgentsConfig {
  return {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    tools: {
      ...baseConfig.tools,
      exec: {
        ...baseConfig.tools?.exec,
        // Default to gateway execution — BuilderForceAgents is designed to let LLMs
        // run commands.  Sandbox requires Docker/Podman which most installs
        // don't have configured out of the box.
        host: baseConfig.tools?.exec?.host ?? "gateway",
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
  };
}
