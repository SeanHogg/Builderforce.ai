import * as vscode from "vscode";
import * as bfApi from "./bfApi";
import { currentCapabilityInputs } from "./capabilityContext";
import { networkDenied } from "./capabilityStates";
/** Where the remembered board id lives. Workspace-scoped: two projects open in two
 *  windows are two pieces of work and should not share a canvas. */
const REMEMBERED_KEY = "builderforce.workspaceCanvasSession";
/** A stable local id for a signed-out board, so a reload does not start a new one. */
const LOCAL_KEY = "builderforce.localCanvasSession";
/**
 * Resolve the board to open.
 *
 * `explicitId` wins — a command that already knows which board it means (a session
 * picked from the tree, a `/create/<id>` link followed out of the canvas, a brand-new
 * board created from a prompt) is not asking this module to choose.
 */
export async function workspaceCanvasSession(ctx, explicitId) {
    if (explicitId) {
        const session = { id: explicitId, title: vscode.l10n.t("Creation Session"), durable: true };
        await remember(ctx, explicitId);
        return session;
    }
    // The capability check comes FIRST (PRD 41 A5): with the platform denied nothing is attempted, so
    // a timeout is never the way this degrades.
    if (networkDenied(currentCapabilityInputs()))
        return localSession(ctx);
    const signedIn = !!(await bfApi.getTenantJwt(ctx.secrets));
    if (!signedIn)
        return localSession(ctx);
    // The board this workspace was last in, if it still exists. The existence check is
    // the point: a remembered id that was since deleted (or belongs to a workspace the
    // user has left) would mount a canvas that 404s on its first read, with no way back.
    const remembered = ctx.workspaceState.get(REMEMBERED_KEY);
    try {
        const sessions = await bfApi.listCreationSessions(ctx.secrets);
        const active = sessions.filter((session) => session.status !== "archived");
        const match = remembered ? active.find((session) => session.id === remembered) : undefined;
        if (match)
            return { id: match.id, title: match.title, durable: true };
        // No remembered board, or it is gone: the most recently touched one is the best
        // guess at "where I was working", and is what the web library would show first.
        const [latest] = active;
        if (latest) {
            await remember(ctx, latest.id);
            return { id: latest.id, title: latest.title, durable: true };
        }
        const created = await bfApi.createCreationSession(ctx.secrets, "");
        await remember(ctx, created.id);
        return { id: created.id, title: created.title, durable: true };
    }
    catch (error) {
        // Offline, or the gateway is refusing. A local board still renders and still runs
        // an on-device model, which beats a panel that says nothing at all — but the
        // degrade is REPORTED rather than silent: a signed-in user handed an empty local
        // board sees exactly what "the canvas doesn't load" looks like, with nothing
        // anywhere saying the session lookup was refused.
        console.error("[builderforce] could not resolve a Canvas session; falling back to a local board", error);
        void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce: could not load your Canvas sessions ({0}). Showing a local board — your conversation is unaffected.", error instanceof Error ? error.message : String(error)));
        return localSession(ctx);
    }
}
async function remember(ctx, id) {
    await ctx.workspaceState.update(REMEMBERED_KEY, id);
}
/** The signed-out board: minted once per workspace and kept, so a reload returns to
 *  the same conversation rather than starting a fresh empty one. */
function localSession(ctx) {
    let id = ctx.workspaceState.get(LOCAL_KEY);
    if (!id) {
        id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        void ctx.workspaceState.update(LOCAL_KEY, id);
    }
    return { id, title: vscode.l10n.t("BuilderForce"), durable: false };
}
//# sourceMappingURL=workspaceSession.js.map