/**
 * BuilderForceAgents plugin: a2a.
 *
 * Registers the A2A (agent-to-agent) tools:
 *
 *  - `a2a-send` — talk to Claude Code (local CLI, streaming JSON) or any other
 *    A2A-compatible HTTP endpoint, and read the reply.
 *  - `a2a-serve` (activated via registerService) — expose this agent over HTTP
 *    at `/a2a` so other agents can send it messages and stream its replies.
 *
 * Wire contract: `packages/agent-tools/src/a2a.ts`.
 */
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { createA2aSendTool } from "./src/a2a-send.js";
import { serveA2AHttp } from "./src/inbound.js";
import { setA2aRuntime } from "./src/runtime.js";

const plugin = {
  id: "a2a",
  name: "A2A (agent-to-agent) bridge",
  description:
    "Agent-to-agent messaging: send messages to Claude Code (and other A2A agents) and expose this agent as an A2A endpoint.",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    setA2aRuntime(api);
    api.registerTool(createA2aSendTool() as never, { optional: true });

    let disposeHttp: (() => void) | null = null;
    api.registerService({
      id: "a2a-http",
      start: () => {
        disposeHttp = serveA2AHttp(api);
        api.logger.info("a2a endpoint available at POST /a2a");
      },
      stop: () => {
        disposeHttp?.();
        disposeHttp = null;
      },
    });
  },
};

export default plugin;
