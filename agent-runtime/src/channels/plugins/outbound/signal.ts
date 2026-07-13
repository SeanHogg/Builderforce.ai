import { chunkText } from "../../../auto-reply/chunk.js";
import { sendMessageSignal } from "../../../signal/send.js";
import { resolveOutboundMaxBytes } from "../media-limits.js";
import type { ChannelOutboundAdapter } from "../types.js";

export const signalOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: chunkText,
  chunkerMode: "text",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId, deps }) => {
    const send = deps?.sendSignal ?? sendMessageSignal;
    const maxBytes = resolveOutboundMaxBytes(cfg, "signal", accountId);
    const result = await send(to, text, {
      maxBytes,
      accountId: accountId ?? undefined,
    });
    return { channel: "signal", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, mediaLocalRoots, accountId, deps }) => {
    const send = deps?.sendSignal ?? sendMessageSignal;
    const maxBytes = resolveOutboundMaxBytes(cfg, "signal", accountId);
    const result = await send(to, text, {
      mediaUrl,
      maxBytes,
      accountId: accountId ?? undefined,
      mediaLocalRoots,
    });
    return { channel: "signal", ...result };
  },
};
