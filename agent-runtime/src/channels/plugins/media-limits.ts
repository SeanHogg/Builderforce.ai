import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { normalizeAccountId } from "../../routing/session-key.js";

const MB = 1024 * 1024;

export function resolveChannelMediaMaxBytes(params: {
  cfg: BuilderForceAgentsConfig;
  // Channel-specific config lives under different keys; keep this helper generic
  // so shared plugin helpers don't need channel-id branching.
  resolveChannelLimitMb: (params: {
    cfg: BuilderForceAgentsConfig;
    accountId: string;
  }) => number | undefined;
  accountId?: string | null;
}): number | undefined {
  const accountId = normalizeAccountId(params.accountId);
  const channelLimit = params.resolveChannelLimitMb({
    cfg: params.cfg,
    accountId,
  });
  if (channelLimit) {
    return channelLimit * MB;
  }
  if (params.cfg.agents?.defaults?.mediaMaxMb) {
    return params.cfg.agents.defaults.mediaMaxMb * MB;
  }
  return undefined;
}

/**
 * Resolve the outbound media byte limit for a channel whose config exposes an
 * account-scoped and channel-level `mediaMaxMb` (per-account wins, then
 * channel-level, then the agent default). Shared by the signal/imessage
 * outbound adapters, which differ only by channel key.
 */
export function resolveOutboundMaxBytes(
  cfg: BuilderForceAgentsConfig,
  channelKey: "signal" | "imessage",
  accountId?: string | null,
): number | undefined {
  return resolveChannelMediaMaxBytes({
    cfg,
    resolveChannelLimitMb: ({ cfg, accountId }) => {
      const channel = cfg.channels?.[channelKey];
      return channel?.accounts?.[accountId]?.mediaMaxMb ?? channel?.mediaMaxMb;
    },
    accountId,
  });
}
