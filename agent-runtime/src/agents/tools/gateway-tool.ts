/**
 * gateway tool — legacy pi (`AnyAgentTool`) wrapper.
 * The implementation lives once in the pi-free
 * `builderforce/shared-tools/node-service-tools.ts` (`runGateway`), shared with the
 * native `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import { Type } from "@sinclair/typebox";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { runGateway } from "../../builderforce/shared-tools/node-service-tools.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult } from "./common.js";

const GATEWAY_ACTIONS = [
  "restart",
  "config.get",
  "config.schema",
  "config.apply",
  "config.patch",
  "update.run",
] as const;

// NOTE: flattened object schema (no nested anyOf) — Claude/Vertex rejects nested
// anyOf; the discriminator (action) determines relevant properties, validated at runtime.
const GatewayToolSchema = Type.Object({
  action: stringEnum(GATEWAY_ACTIONS),
  delayMs: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  raw: Type.Optional(Type.String()),
  baseHash: Type.Optional(Type.String()),
  sessionKey: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  restartDelayMs: Type.Optional(Type.Number()),
});

export function createGatewayTool(opts?: {
  agentSessionKey?: string;
  config?: BuilderForceAgentsConfig;
}): AnyAgentTool {
  return {
    label: "Gateway",
    name: "gateway",
    description:
      "Restart, apply config, or update the gateway in-place (SIGUSR1). Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Both trigger restart after writing. Always pass a human-readable completion message via the `note` parameter so the system can deliver it to the user after restart.",
    parameters: GatewayToolSchema,
    execute: async (_toolCallId, args) =>
      jsonResult(
        await runGateway(
          { config: opts?.config, agentSessionKey: opts?.agentSessionKey },
          args as Record<string, unknown>,
        ),
      ),
  };
}
