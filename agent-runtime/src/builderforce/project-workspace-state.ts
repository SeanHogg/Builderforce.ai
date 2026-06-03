import fs from "node:fs/promises";
import path from "node:path";
import { resolveBuilderForceAgentsDir, WORKSPACE_STATE_FILE } from "./project-dir.js";

export type WorkspaceState = {
  version: number;
  bootstrapSeededAt?: string;
  lastSyncedAt?: string;
  syncCount?: number;
};

export async function loadWorkspaceState(projectRoot: string): Promise<WorkspaceState> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  const filePath = path.join(dir.root, WORKSPACE_STATE_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    return { version: 1 };
  }
}

export async function updateWorkspaceState(
  projectRoot: string,
  updates: Partial<WorkspaceState>,
): Promise<void> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  const filePath = path.join(dir.root, WORKSPACE_STATE_FILE);
  const existing = await loadWorkspaceState(projectRoot);
  const updated: WorkspaceState = { ...existing, ...updates };
  await fs.mkdir(dir.root, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
}
