import { chunkText } from "../../../auto-reply/chunk.js";
import { sendMessageIMessage } from "../../../imessage/send.js";
import { resolveOutboundMaxBytes } from "../media-limits.js";
import type { ChannelOutboundAdapter } from "../types.js";

export const imessageOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: chunkText,
  chunkerMode: "text",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId, deps, replyToId }) => {
    const send = deps?.sendIMessage ?? sendMessageIMessage;
    const maxBytes = resolveOutboundMaxBytes(cfg, "imessage", accountId);
    const result = await send(to, text, {
      maxBytes,
      accountId: accountId ?? undefined,
      replyToId: replyToId ?? undefined,
    });
    return { channel: "imessage", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, mediaLocalRoots, accountId, deps, replyToId }) => {
    const send = deps?.sendIMessage ?? sendMessageIMessage;
    const maxBytes = resolveOutboundMaxBytes(cfg, "imessage", accountId);
    const result = await send(to, text, {
      mediaUrl,
      maxBytes,
      accountId: accountId ?? undefined,
      replyToId: replyToId ?? undefined,
      mediaLocalRoots,
    });
    return { channel: "imessage", ...result };
  },
};
