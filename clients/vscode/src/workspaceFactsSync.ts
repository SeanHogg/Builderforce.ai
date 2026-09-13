/**
 * Publishes the workspace digest (`workspaceFacts.ts`) into the ACTIVE project's shared
 * facts store, and keeps it in step: after every codebase scan, and whenever the user
 * switches project.
 *
 * Writes only what changed. Each fact's content hash is remembered per project in
 * `.builderforce/facts-published.json`, so an unchanged sub-project costs nothing on the
 * next scan, and a sub-project that disappeared has its fact retired (only keys under
 * the `workspace:` prefix this module owns — never a fact a person or an agent wrote).
 * A write that fails is not recorded, so the next sync retries it. Best-effort
 * throughout: a signed-out or offline editor simply publishes nothing.
 */

import type * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { forgetProjectFact, rememberProjectFact } from "./bfApi";
import type { ScanResult } from "./codebaseScan";
import { getSelectedProject } from "./projectState";
import { buildWorkspaceFacts, WORKSPACE_FACT_PREFIX, type WorkspaceDigest } from "./workspaceFacts";
import { workspaceSymbolIndex } from "./workspaceSymbols";

/** Content hashes of the facts this editor last published, by project id then key. */
type PublishedState = Record<string, Record<string, string>>;

let latest: { root: string; digest: WorkspaceDigest } | undefined;
let queue: Promise<void> = Promise.resolve();

const hashOf = (content: string): string => crypto.createHash("sha1").update(content).digest("hex").slice(0, 16);

function statePath(root: string): string {
  return path.join(root, ".builderforce", "facts-published.json");
}

async function readState(root: string): Promise<PublishedState> {
  try {
    return JSON.parse(await fs.readFile(statePath(root), "utf-8")) as PublishedState;
  } catch {
    return {};
  }
}

/** Package name/description for each `package.json` sub-project — what a recall matches on. */
async function readPackages(root: string, manifests: string[]): Promise<WorkspaceDigest["packages"]> {
  const out: NonNullable<WorkspaceDigest["packages"]> = {};
  for (const manifest of manifests.filter((m) => path.posix.basename(m) === "package.json")) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, manifest), "utf-8")) as { name?: unknown; description?: unknown };
      out[path.posix.dirname(manifest)] = {
        ...(typeof pkg.name === "string" ? { name: pkg.name } : {}),
        ...(typeof pkg.description === "string" ? { description: pkg.description.slice(0, 160) } : {}),
      };
    } catch {
      /* unreadable manifest — the fact just goes without a package name */
    }
  }
  return out;
}

async function publish(secrets: vscode.SecretStorage): Promise<void> {
  const project = getSelectedProject();
  if (!project || !latest) return;
  const { root, digest } = latest;
  const facts = buildWorkspaceFacts(digest, await workspaceSymbolIndex(root).filesUnder());
  const state = await readState(root);
  const previous = state[String(project.id)] ?? {};
  const next: Record<string, string> = {};
  for (const fact of facts) {
    const hash = hashOf(fact.content);
    if (previous[fact.key] === hash || (await rememberProjectFact(secrets, project.id, fact.key, fact.content))) {
      next[fact.key] = hash;
    }
  }
  const current = new Set(facts.map((f) => f.key));
  for (const [key, hash] of Object.entries(previous)) {
    if (current.has(key) || !key.startsWith(WORKSPACE_FACT_PREFIX)) continue;
    // Kept in the state when the delete fails, so the next sync retries the retirement.
    if (!(await forgetProjectFact(secrets, project.id, key))) next[key] = hash;
  }
  state[String(project.id)] = next;
  try {
    await fs.mkdir(path.dirname(statePath(root)), { recursive: true });
    await fs.writeFile(statePath(root), JSON.stringify(state, null, 2), "utf-8");
  } catch {
    /* best-effort: an unwritable state file only means the next sync re-checks every fact */
  }
}

/** Publish the latest digest to the active project. Serialized: a project switch mid-sync queues. */
export function syncWorkspaceFacts(secrets: vscode.SecretStorage): Promise<void> {
  queue = queue.then(() => publish(secrets)).catch((e) => console.error("BuilderForce workspace facts sync failed:", e));
  return queue;
}

/**
 * The scan's follow-through: warm the definition index (so the first `find_symbol` is
 * instant rather than a cold walk), then publish the digest built from it.
 */
export async function afterWorkspaceScan(secrets: vscode.SecretStorage, root: string, scan: ScanResult): Promise<void> {
  await workspaceSymbolIndex(root).refresh();
  latest = {
    root,
    digest: { manifests: scan.manifests, overview: scan.overview, packages: await readPackages(root, scan.manifests) },
  };
  await syncWorkspaceFacts(secrets);
}
