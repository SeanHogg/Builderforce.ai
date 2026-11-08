/**
 * Validate a `local.chatRail` request body at the bridge edge: the webview is another realm, so
 * nothing in it is trusted to be shaped as `ChatRailRequest`.
 */

import type { ChatRailRequest, ChatRef } from "./railProtocol";

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function asChatRef(value: unknown): ChatRef | undefined {
  if (text(value)) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function parseChatRailRequest(body: unknown): ChatRailRequest | undefined {
  if (!body || typeof body !== "object") return undefined;
  const msg = body as Record<string, unknown>;
  const chatId = asChatRef(msg.chatId);
  if (chatId === undefined) return undefined;
  switch (msg.action) {
    case "read":
    case "refresh":
      return { action: msg.action, chatId };
    case "link":
      return text(msg.kind) && text(msg.ref)
        ? { action: "link", chatId, kind: msg.kind, ref: msg.ref, linkType: msg.linkType === "created" ? "created" : "linked" }
        : undefined;
    case "unlink":
      return text(msg.kind) && text(msg.ref) ? { action: "unlink", chatId, kind: msg.kind, ref: msg.ref } : undefined;
    default:
      return undefined;
  }
}
