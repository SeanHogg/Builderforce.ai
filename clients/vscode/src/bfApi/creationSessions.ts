import type * as vscode from "vscode";
import { authed } from "./transport";

/** Create a durable unified Canvas session from the editor. */
export async function createCreationSession(
  secrets: vscode.SecretStorage,
  prompt: string,
): Promise<{ id: string; title: string; revision: number }> {
  const result = await authed<{ session: { id: string; title: string; revision: number } }>(secrets, "/api/creation-sessions", {
    method: "POST",
    body: JSON.stringify({ title: prompt.trim().slice(0, 80) || "Untitled session", initialPrompt: prompt.trim() }),
  });
  if (!result?.session) throw new Error("not signed in");
  return result.session;
}

export interface BfCreationSessionSummary {
  id: string;
  title: string;
  revision: number;
  lastActivityAt: string;
  status?: "active" | "archived";
  pinned?: boolean;
  unread?: boolean;
  collaboratorCount?: number;
  /**
   * The board's card face, as `buildPreview` writes it
   * (`api/src/application/creation/creationGraphWriter.ts`).
   *
   * `resourceType` / `resourceId` were always in the payload and were simply not
   * declared here. They are what says WHICH record a card stands for, and the
   * sessions list needs them: a chat this board already holds a card for must not
   * also get a row of its own, because both open the same panel on the same
   * conversation. See `sessionsLibrary.ts`.
   */
  preview?: { objects?: Array<{ status?: string; resourceType?: string | null; resourceId?: string | null }> } | null;
}

export async function listCreationSessions(secrets: vscode.SecretStorage): Promise<BfCreationSessionSummary[]> {
  const result = await authed<{ sessions: BfCreationSessionSummary[] }>(secrets, "/api/creation-sessions?limit=50");
  return result?.sessions ?? [];
}
