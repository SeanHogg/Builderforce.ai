import * as vscode from "vscode";
import { boundToken, refreshTenantJwt } from "./bfApi";
import { logLine } from "./errorReporter";
import { getBaseUrl, getWebBaseUrl } from "./gateway";
import { localBrainApplication } from "./localFirstStore";
import { platformInferenceMode, platformPolicy } from "./platformPolicy";
import { assertPlatformSocketAllowed, platformPolicyFrame, platformSocketUrl } from "./platformCallGate";
import { isInferenceMode } from "@builderforce/local-first";
import { setInferenceMode } from "./inferenceModeSetting";
import { DOWNLOAD_LOCAL_MODEL_COMMAND } from "./noLocalModelPrompt";
import { callLocalPersistence } from "./localPersistenceDispatch";
import { createLocalWorkRepository } from "./localWorkRepository";
import { handleChatRailRequest } from "./chatRail/chatRailHost";
import { signInToAccountProvider } from "./providerConnect";
import { withFreshNonce } from "./webviewBundleShell";
/** Webviews receiving policy pushes, each with the subscription that forgets it on dispose. */
const watchedWebviews = new Map();
let policyPushInstalled = false;
/** The frame last pushed to every watched webview — a push happens only when this changes. */
let lastBroadcastKey;
function currentPolicyFrame() {
    return platformPolicyFrame(getBaseUrl(), getWebBaseUrl());
}
function publishPlatformPolicy(webview, frame) {
    try {
        void webview.postMessage(frame);
    }
    catch (error) {
        // A disposed webview throws on access. Forget it; the dispose hook may not have run yet.
        logLine(`[webview] policy push dropped: ${error instanceof Error ? error.message : String(error)}`);
        forgetWebview(webview);
    }
}
/**
 * A commit touched the tickets a chat row's % rolls up from (or the links that bind
 * them): every history row is re-derived from these at list-read time, so a change
 * here means a row may be stale.
 */
export function ticketProgressChangeTouches(change) {
    return !!change && (change.records.has("ticket") || change.records.has("chat-ticket-link"));
}
/**
 * The store's ticket / link writes reach the open chat's rail as a pushed frame, which
 * re-reads the list — but a chat that is NOT open has no rail watch, so its row sat on
 * the old % until you opened it (and forced a rail read → list reload). Watch the store
 * once and push `refresh` to every live webview when a ticket or chat-ticket-link
 * write lands, so the history re-reads for whichever chat actually moved. `refresh`
 * is cheap and idempotent: the panel reloads its list, and identical rows render the same.
 */
let ticketProgressPushInstalled = false;
function watchTicketProgress(ctx) {
    if (ticketProgressPushInstalled)
        return;
    ticketProgressPushInstalled = true;
    localBrainApplication(ctx).store.subscribe((change) => {
        if (!ticketProgressChangeTouches(change))
            return;
        for (const view of [...watchedWebviews.keys()]) {
            try {
                void view.postMessage({ type: "refresh" });
            }
            catch (error) {
                logLine(`[webview] ticket-progress refresh dropped: ${error instanceof Error ? error.message : String(error)}`);
                forgetWebview(view);
            }
        }
    });
}
function forgetWebview(webview) {
    watchedWebviews.get(webview)?.dispose();
    watchedWebviews.delete(webview);
}
/**
 * Push the host snapshot once when a webview is first seen, and again only when the
 * host policy actually changes. Disposed webviews are removed by their owner's
 * `onDidDispose` — `postMessage` on a disposed webview resolves, so a failed post can
 * not be relied on to prune.
 */
function watchPlatformPolicy(webview, owner) {
    if (!webview || !owner || watchedWebviews.has(webview))
        return;
    if (!policyPushInstalled) {
        policyPushInstalled = true;
        platformPolicy().subscribe(() => {
            const frame = currentPolicyFrame();
            const key = JSON.stringify(frame);
            if (key === lastBroadcastKey)
                return;
            lastBroadcastKey = key;
            for (const view of [...watchedWebviews.keys()])
                publishPlatformPolicy(view, frame);
        });
    }
    watchedWebviews.set(webview, owner.onDidDispose(() => forgetWebview(webview)));
    const frame = currentPolicyFrame();
    lastBroadcastKey ??= JSON.stringify(frame);
    publishPlatformPolicy(webview, frame);
}
/** Webviews currently receiving policy pushes. For tests and diagnostics. */
export function watchedWebviewCount() {
    return watchedWebviews.size;
}
/**
 * Fire-and-forget post to a webview. A no-op when the surface is not resolved.
 * Pass the `owner` (panel or view) so an `init` frame also subscribes the webview to
 * policy changes until its owner is disposed.
 */
export function postToWebview(webview, msg, owner) {
    if (!webview)
        return;
    if (msg && typeof msg === "object" && msg.type === "init") {
        watchPlatformPolicy(webview, owner);
        const frame = msg;
        if (!frame.platformPolicy) {
            void webview.postMessage({
                ...frame,
                platformPolicy: platformPolicy().snapshot(),
                // The realm decides with the shared gate, which needs the mode as well.
                inferenceMode: frame.inferenceMode ?? platformInferenceMode(),
                baseUrl: frame.baseUrl ?? getBaseUrl(),
            });
            return;
        }
    }
    void webview.postMessage(msg);
}
/**
 * Reply to a webview `request` round-trip.
 *
 * A no-op without an `id` — that is a fire-and-forget message, and answering one
 * would leave a response nothing is waiting for.
 */
export function respondToWebview(webview, id, ok, result, error) {
    if (!id || !webview)
        return;
    void webview.postMessage({ type: "response", id, ok, result, ...(error ? { error } : {}) });
}
/** One output-channel line per failed answer: the endpoint, the status, the API's
 *  reference (the lookup key of its stored error row) and its sentence. */
export function apiFailureLine(m) {
    const ref = m.errorId ? ` · ref ${m.errorId}` : "";
    const said = m.error ? ` — ${m.error}` : "";
    return `[webview api] ${m.method ?? "GET"} ${m.path ?? "?"} → ${m.status ?? "?"}${ref}${said}`;
}
/** The output-channel block for one webview error: a headline, then each stack that came with it. */
export function webviewErrorLines(m) {
    const text = (value) => (typeof value === "string" ? value.trim() : "");
    const lines = [`[webview error] ${text(m.source) || "render"}: ${text(m.message) || "unknown error"}`];
    if (text(m.stack))
        lines.push(text(m.stack));
    if (text(m.componentStack))
        lines.push(`component stack:\n${text(m.componentStack)}`);
    return lines.join("\n");
}
/** A PreFetch answer chip may run only the extension's own commands. */
export function isPrefetchChipCommand(command) {
    return typeof command === "string" && /^builderforce\.[\w.-]+$/.test(command);
}
/**
 * Handle the cases the HOST owns on every surface. Returns true when the message
 * was handled, so a caller's own switch runs only for its own messages.
 *
 * Both cases are host-owned for the same reason: a webview cannot reach the
 * extension's secret storage, and cannot run a command.
 */
export async function handleSharedHostMessage(ctx, webview, msg, owner) {
    // First message from this webview subscribes it; every later one is a no-op here.
    watchPlatformPolicy(webview, owner);
    watchTicketProgress(ctx);
    const socket = platformSocketUrl(msg);
    if (socket) {
        try {
            assertPlatformSocketAllowed(socket);
        }
        catch (error) {
            respondToWebview(webview, msg.id, false, undefined, error instanceof Error ? error.message : String(error));
            return true;
        }
    }
    switch (msg.type) {
        // Sent on a 401 (or with no token yet): a FRESH mint, never the cached token the
        // gateway just refused.
        case "token.refresh": {
            // Only a token bound to the workspace in force goes out (`boundToken`): fails closed.
            const bound = boundToken(await refreshTenantJwt(ctx.secrets));
            respondToWebview(webview, msg.id, true, { token: bound?.token ?? null, tenantId: bound?.tenantId });
            return true;
        }
        case "local.persistence": {
            const request = msg;
            const answer = await callLocalPersistence(localBrainApplication(ctx).persistence, request.method, request.args, logLine);
            if (answer.ok)
                respondToWebview(webview, msg.id, true, answer.result);
            else
                respondToWebview(webview, msg.id, false, undefined, answer.error);
            return true;
        }
        /**
         * The `#` typeahead's OFFLINE fallback: the host's local ticket store (G05). No
         * network — the repository reads only the durable local-first store, so this
         * answers (with the live, not-tombstoned tickets) when the platform is denied
         * and a server `listTickets` cannot run. A host without the store still answers
         * `[]`, never a refusal: an empty picker is a correct "no local tickets".
         */
        case "local.tickets": {
            try {
                const app = localBrainApplication(ctx);
                const repo = createLocalWorkRepository({ store: app.store, deviceId: app.deviceId });
                const tickets = await repo.listTickets();
                respondToWebview(webview, msg.id, true, tickets.map((t) => ({ id: t.id, title: t.payload.title, status: t.payload.status })));
            }
            catch (error) {
                logLine(`[webview] local.tickets failed: ${error instanceof Error ? error.message : String(error)}`);
                respondToWebview(webview, msg.id, true, []);
            }
            return true;
        }
        // The rail's local copy and its local link writes (G21).
        case "local.chatRail": {
            const answer = await handleChatRailRequest(ctx, webview, owner, msg);
            if (answer.ok)
                respondToWebview(webview, msg.id, true, answer.result);
            else
                respondToWebview(webview, msg.id, false, undefined, answer.error);
            return true;
        }
        case "signin":
            void vscode.commands.executeCommand("builderforce.signIn");
            return true;
        // The `/` menu's mode control and the first-run question: applied at once (the turn
        // the question held runs in it), persisted, and re-pushed to every panel via `init`.
        case "setInferenceMode": {
            const mode = msg.mode;
            if (isInferenceMode(mode))
                void setInferenceMode(mode);
            return true;
        }
        // "Download a local model" from the chat banner: the model picker's on-device list.
        case "downloadLocalModel":
            void vscode.commands.executeCommand(DOWNLOAD_LOCAL_MODEL_COMMAND);
            return true;
        case "connectProvider":
            void vscode.commands.executeCommand("builderforce.manageByoConnections");
            return true;
        case "providerSignIn":
            void signInToAccountProvider(ctx.secrets, msg.provider);
            return true;
        case "api.failure":
            logLine(apiFailureLine(msg));
            return true;
        // Logged only: the root fallback already tells the reader, and an uncaught error
        // the tree survived needs no toast — the output channel is the record.
        case "webview.error":
            logLine(webviewErrorLines(msg));
            return true;
        // A fresh nonce makes it a different document, which VS Code re-renders from scratch.
        case "webview.reload":
            if (webview)
                webview.html = withFreshNonce(webview.html);
            return true;
        case "webview.copy": {
            const text = msg.text;
            if (typeof text !== "string" || !text)
                return true;
            await vscode.env.clipboard.writeText(text);
            void vscode.window.showInformationMessage(vscode.l10n.t("Error details copied to clipboard."));
            return true;
        }
        // A chip under a PreFetch answer (e.g. Open in graph): runs ITS command — only one of
        // ours, since the webview names it.
        case "prefetch.chip": {
            const chip = msg;
            if (isPrefetchChipCommand(chip.command))
                void vscode.commands.executeCommand(chip.command, chip.args);
            return true;
        }
        default:
            return false;
    }
}
//# sourceMappingURL=webviewHostBridge.js.map