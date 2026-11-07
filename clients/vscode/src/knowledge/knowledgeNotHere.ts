/**
 * `load`'s typed answer for a root this machine holds no review of (PRD 41 A7): not a failed read
 * and not the server's cut, but "Not reviewed on this machine". The view offers Review, and — only when
 * the workspace is linked AND the project is reachable right now — also "Use the server's copy" (a local
 * review with a server read-through, `reviewRoot(…, { seed: true })`).
 *
 * Reachability is a cheap probe (the scopes call), cached for 30 s per project, so opening an empty
 * root offline never hangs and never offers a copy it cannot fetch.
 */

import type * as vscode from "vscode";
import { platformCapabilityAllows } from "../platformPolicy";
import { getSelectedProject } from "../projectState";
import type { KnowledgeNotReviewedHere } from "./knowledgeProtocol";
import { rootById } from "./knowledgeRoots";
import { linkedKnowledgeClient, workspaceFolders } from "./knowledgeService";

const PROBE_TTL_MS = 30_000;
let probed: { projectId: number | undefined; at: number; ok: boolean } | undefined;

/** Forgets the cached probe (tests; a sign-in). */
export function forgetReachability(): void { probed = undefined; }

async function reachable(client: { scopes(): Promise<unknown> }, now: number): Promise<boolean> {
  const projectId = getSelectedProject()?.id;
  if (probed && probed.projectId === projectId && now - probed.at < PROBE_TTL_MS) return probed.ok;
  const ok = await client.scopes().then(() => true, () => false);
  probed = { projectId, at: now, ok };
  return ok;
}

/** The answer for `rootId` when it is an open workspace root with no local graph; null for any other root. */
export async function notReviewedHere(secrets: vscode.SecretStorage, rootId: string, now: number = Date.now()): Promise<KnowledgeNotReviewedHere | null> {
  if (!rootById(rootId, workspaceFolders())) return null;
  const client = linkedKnowledgeClient(secrets);
  const canSeed = !!client && platformCapabilityAllows("synchronize") && (await reachable(client, now));
  return { notReviewedHere: { canSeed } };
}
