import * as vscode from "vscode";
import * as bfApi from "./bfApi";

/**
 * THE BOARD THIS EDITOR WORKS IN.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The chat panel never needed one: a conversation was its own thing, in its own
 * tab, with nothing behind it. Now chat is a SURFACE of the canvas
 * (`frontend/src/lib/canvasSurfaces.ts` — "the zero-object case of the board"),
 * so opening chat means opening a board and standing its graph down. Something has
 * to answer WHICH board, and it must answer the same way every time: landing in a
 * brand-new empty session each time somebody opens their chat would quietly scatter
 * one person's work across dozens of boards.
 *
 * So the answer is remembered per workspace. `Open Chat` twice returns to the same
 * conversation and the same objects behind it — which is what a person who never
 * closed the panel expects — while `Open Canvas` with a prompt still creates a new
 * board deliberately, by passing its id in.
 *
 * ── SIGNED OUT ───────────────────────────────────────────────────────────────
 * There is nothing to create server-side and nothing to remember across machines,
 * but the panel must still render: an on-device model runs on the user's own
 * hardware and gating them out of it would be absurd (the same argument the sign-in
 * gate in `WorkspaceApp` makes). So a LOCAL id is minted and the canvas is mounted
 * against it — the board lives in this browser context and nowhere else, exactly as
 * the signed-out chat's in-memory transcript already did.
 */

export interface WorkspaceCanvasSession {
  id: string;
  title: string;
  /** False for a signed-out board, which exists only inside this panel. */
  durable: boolean;
}

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
export async function workspaceCanvasSession(
  ctx: vscode.ExtensionContext,
  explicitId?: string,
): Promise<WorkspaceCanvasSession> {
  if (explicitId) {
    const session = { id: explicitId, title: vscode.l10n.t("Creation Session"), durable: true };
    await remember(ctx, explicitId);
    return session;
  }

  const signedIn = !!(await bfApi.getTenantJwt(ctx.secrets));
  if (!signedIn) return localSession(ctx);

  // The board this workspace was last in, if it still exists. The existence check is
  // the point: a remembered id that was since deleted (or belongs to a workspace the
  // user has left) would mount a canvas that 404s on its first read, with no way back.
  const remembered = ctx.workspaceState.get<string>(REMEMBERED_KEY);
  try {
    const sessions = await bfApi.listCreationSessions(ctx.secrets);
    const active = sessions.filter((session) => session.status !== "archived");
    const match = remembered ? active.find((session) => session.id === remembered) : undefined;
    if (match) return { id: match.id, title: match.title, durable: true };
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
  } catch (error) {
    // Offline, or the gateway is refusing. A local board still renders and still runs
    // an on-device model, which beats a panel that says nothing at all — but the
    // degrade is REPORTED rather than silent: a signed-in user handed an empty local
    // board sees exactly what "the canvas doesn't load" looks like, with nothing
    // anywhere saying the session lookup was refused.
    console.error("[builderforce] could not resolve a Canvas session; falling back to a local board", error);
    void vscode.window.showWarningMessage(
      vscode.l10n.t(
        "BuilderForce: could not load your Canvas sessions ({0}). Showing a local board — your conversation is unaffected.",
        error instanceof Error ? error.message : String(error),
      ),
    );
    return localSession(ctx);
  }
}

async function remember(ctx: vscode.ExtensionContext, id: string): Promise<void> {
  await ctx.workspaceState.update(REMEMBERED_KEY, id);
}

/** The signed-out board: minted once per workspace and kept, so a reload returns to
 *  the same conversation rather than starting a fresh empty one. */
function localSession(ctx: vscode.ExtensionContext): WorkspaceCanvasSession {
  let id = ctx.workspaceState.get<string>(LOCAL_KEY);
  if (!id) {
    id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    void ctx.workspaceState.update(LOCAL_KEY, id);
  }
  return { id, title: vscode.l10n.t("BuilderForce"), durable: false };
}
