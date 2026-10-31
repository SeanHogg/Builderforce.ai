import type * as vscode from "vscode";
import { authed } from "./transport";

export interface BfProject {
  id: number;
  name: string;
  key?: string;
  status?: string;
}

export async function listProjects(secrets: vscode.SecretStorage): Promise<BfProject[]> {
  const r = await authed<{ projects: BfProject[] }>(secrets, "/api/projects");
  return r?.projects ?? [];
}

/**
 * Create a project in the signed-in workspace (tenant) — POST /api/projects, which
 * accepts the extension's tenant JWT. Surfaces the plan-limit (402) message verbatim
 * so the caller can prompt an upgrade. The created project is returned for selection.
 */
export async function createProject(
  secrets: vscode.SecretStorage,
  name: string,
): Promise<BfProject> {
  const project = await authed<BfProject>(secrets, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!project) throw new Error("not signed in");
  return project;
}
