/**
 * The host side of `local.chatRail` (G21): builds the one rail service over the host store and
 * answers the webview's typed requests with it.
 *
 * A webview that reads or refreshes a chat is also WATCHED: every later commit that touches that
 * chat's rail posts a `local.chatRail` frame, so the rail repaints from the store, not from a poll.
 * One watch per webview: switching chat releases the previous one, and the panel's dispose the last.
 */

import type * as vscode from "vscode";
import { authed } from "../bfApi";
import { localBrainApplication } from "../localFirstStore";
import { platformCapabilityAllows } from "../platformPolicy";
import { hostSyncSummaryPorts } from "../sync/hostSyncSummary";
import { readSyncSummary } from "../sync/syncSummary";
import { parseChatRailRequest } from "./railRequest";
import { createChatRailService, type ChatRailService } from "./railService";
import { watchRailFor } from "./railWebviewWatch";

const services = new WeakMap<vscode.ExtensionContext, ChatRailService>();

export function chatRailServiceFor(ctx: vscode.ExtensionContext): ChatRailService {
  const existing = services.get(ctx);
  if (existing) return existing;
  const app = localBrainApplication(ctx);
  const summaryPorts = hostSyncSummaryPorts(app.durableStore);
  const service = createChatRailService({
    store: app.store,
    deviceId: app.deviceId,
    facts: () => app.durableStore.view(),
    summary: () => readSyncSummary(summaryPorts),
    platform: {
      platformAllowed: () => platformCapabilityAllows("connected-feature"),
      get: <T>(path: string) => authed<T>(ctx.secrets, path),
    },
  });
  services.set(ctx, service);
  return service;
}

/** What the bridge answers with: a result, or the reason the request was refused. */
export type ChatRailAnswer = { ok: true; result: unknown } | { ok: false; error: string };

export async function handleChatRailRequest(
  ctx: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
  owner: { onDidDispose(listener: () => void): unknown } | undefined,
  body: unknown,
): Promise<ChatRailAnswer> {
  const request = parseChatRailRequest(body);
  if (!request) return { ok: false, error: "chat_rail_request_invalid" };
  const service = chatRailServiceFor(ctx);
  if (webview && owner && (request.action === "read" || request.action === "refresh")) {
    watchRailFor(service, webview, owner, request.chatId);
  }
  switch (request.action) {
    case "read":
      return { ok: true, result: await service.read(request.chatId) };
    case "refresh":
      return { ok: true, result: await service.refresh(request.chatId) };
    case "link":
      return { ok: true, result: await service.link(request.chatId, { kind: request.kind, ref: request.ref }, request.linkType) };
    case "unlink":
      return { ok: true, result: await service.unlink(request.chatId, { kind: request.kind, ref: request.ref }) };
  }
}
