import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { LLMTaskTool } from "./src/llm-task-tool.js";
import notificationStorage from "./src/notification-storage.js";

export default function register(api: BuilderForceAgentsPluginApi): void {
  const tool = new LLMTaskTool(
    {
      enabled: true,
      platformName: "Builderforce",
      platformLoginUrl: "https://builderforce.ai",
    },
    // AccountUtil is created by the runtime in the setup phase
    // We'll retrieve it from the context passed by the runtime
    (api as any).accountUtil ?? {}
  );

  // Register the tool as an agent tool
  // In a real integration, you'd register it as a proper agent tool
  // For now, we register it as a custom extension
  (api as any).registerExtension?.("llmTaskTool", tool) ?? console.log("[llm-task] Plugin registered");
}