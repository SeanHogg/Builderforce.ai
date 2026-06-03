import type {
  AnyAgentTool,
  BuilderForceAgentsPluginApi,
  BuilderForceAgentsPluginToolFactory,
} from "../../src/plugins/types.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: BuilderForceAgentsPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as BuilderForceAgentsPluginToolFactory,
    { optional: true },
  );
}
