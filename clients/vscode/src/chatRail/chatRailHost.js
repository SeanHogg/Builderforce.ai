/**
 * The host side of `local.chatRail` (G21): builds the one rail service over the host store and
 * answers the webview's typed requests with it.
 *
 * A webview that reads or refreshes a chat is also WATCHED: every later commit that touches that
 * chat's rail posts a `local.chatRail` frame, so the rail repaints from the store, not from a poll.
 * One watch per webview: switching chat releases the previous one, and the panel's dispose the last.
 */
import { authed } from "../bfApi";
import { activeEntityScope } from "../chatAccount";
import { localBrainApplication } from "../localFirstStore";
import { platformCapabilityAllows } from "../platformPolicy";
import { hostSyncSummaryPorts } from "../sync/hostSyncSummary";
import { readSyncSummary } from "../sync/syncSummary";
import { parseChatRailRequest } from "./railRequest";
import { createChatRailService } from "./railService";
import { watchRailFor } from "./railWebviewWatch";
const services = new WeakMap();
export function chatRailServiceFor(ctx) {
    const existing = services.get(ctx);
    if (existing)
        return existing;
    const app = localBrainApplication(ctx);
    const summaryPorts = hostSyncSummaryPorts(app.durableStore);
    const service = createChatRailService({
        store: app.store,
        deviceId: app.deviceId,
        facts: () => app.durableStore.view(),
        summary: () => readSyncSummary(summaryPorts),
        scope: activeEntityScope,
        platform: {
            platformAllowed: () => platformCapabilityAllows("connected-feature"),
            get: (path) => authed(ctx.secrets, path),
        },
    });
    services.set(ctx, service);
    return service;
}
export async function handleChatRailRequest(ctx, webview, owner, body) {
    const request = parseChatRailRequest(body);
    if (!request)
        return { ok: false, error: "chat_rail_request_invalid" };
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
//# sourceMappingURL=chatRailHost.js.map