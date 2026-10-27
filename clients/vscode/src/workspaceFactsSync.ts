/**
 * Publishes the workspace digest (`workspaceFacts.ts`) into the project snapshotted
 * when the digest was produced. A later change of the selected project is not a
 * rebind — call {@link rebindWorkspaceFactsDestination} for that. `syncWorkspaceFacts`
 * never reads the live selection.
 *
 * Writes only what changed. Each fact's content hash is remembered per project in
 * `.builderforce/facts-published.json`, so an unchanged sub-project costs nothing on the
 * next scan, and a sub-project that disappeared has its fact retired (only keys under
 * the `workspace:` prefix this module owns — never a fact a person or an agent wrote).
 * A write that is not acknowledged is retained in `.builderforce/facts-retained.json`
 * and this call rejects, so a signed-out or offline editor does not treat the publish
 * as done. The next sync retries it until the platform acknowledges it. A digest
 * snapshotted with no project stays unpublished until an explicit rebind or a new scan.
 */

import type * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { destinationKey, type EntityDestination } from "@builderforce/local-first";
import { classifyQueue } from "@builderforce/write-outbox";
import { forgetProjectFact, rememberProjectFact } from "./bfApi";
import type { ScanResult } from "./codebaseScan";
import { invalidateStableGrounding } from "./grounding";
import { getSelectedProject, type SelectedProject } from "./projectState";
import { buildWorkspaceFacts, WORKSPACE_FACT_PREFIX, type WorkspaceDigest } from "./workspaceFacts";
import { workspaceSymbolIndex } from "./workspaceSymbols";

/** Content hashes of the facts this editor last published, by project id then key. */
type PublishedState = Record<string, Record<string, string>>;

/** Destination copied when the digest intent was created. Publish reads this, not the picker. */
interface FactIntent {
  root: string;
  digest: WorkspaceDigest;
  destination: SelectedProject | null;
  destinationKey: string;
}

let latest: FactIntent | undefined;

function snapshotSelection(project: SelectedProject | null | undefined): Pick<FactIntent, "destination" | "destinationKey"> {
  if (!project || !Number.isFinite(project.id)) {
    return { destination: null, destinationKey: destinationKey({ kind: "unbound" }) };
  }
  const destination = { id: project.id, name: project.name };
  const bound: EntityDestination = { kind: "bound", projectId: String(destination.id) };
  return { destination, destinationKey: destinationKey(bound) };
}

/**
 * Explicit rebind of the pending digest. A project-selection change must not call this;
 * `syncWorkspaceFacts` does not.
 */
export function rebindWorkspaceFactsDestination(project: SelectedProject | null | undefined): void {
  if (!latest) return;
  latest = { ...latest, ...snapshotSelection(project) };
}

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

/** A fact publish the platform has not acknowledged. Retained until it does. */
interface RetainedFact {
  projectId: number;
  key: string;
  hash: string;
  op: "remember" | "forget";
  content: string;
}

function retainedPath(root: string): string {
  return path.join(root, ".builderforce", "facts-retained.json");
}

const FACT_PUBLISH = "fact-publish";

/** User work. An unclassified fact publish is still retained. Only an explicit best-effort class drops it. */
function retainUnackedFacts(): boolean {
  const classified = classifyQueue(FACT_PUBLISH);
  if (!classified) return true;
  return classified.retention !== "best-effort" && classified.onFailure !== "drop-on-failure";
}

function retainedId(item: Pick<RetainedFact, "projectId" | "op" | "key">): string {
  return `${item.projectId}\0${item.op}\0${item.key}`;
}

function isRetainedFact(item: unknown): item is RetainedFact {
  if (!item || typeof item !== "object") return false;
  const row = item as RetainedFact;
  return typeof row.projectId === "number"
    && typeof row.key === "string"
    && typeof row.hash === "string"
    && typeof row.content === "string"
    && (row.op === "remember" || row.op === "forget");
}

async function readRetained(root: string): Promise<RetainedFact[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(retainedPath(root), "utf-8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRetainedFact) : [];
  } catch {
    return [];
  }
}

async function writeRetained(root: string, items: RetainedFact[]): Promise<void> {
  const file = retainedPath(root);
  if (items.length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(items, null, 2), "utf-8");
}

function dedupeRetained(items: RetainedFact[]): RetainedFact[] {
  const byId = new Map<string, RetainedFact>();
  for (const item of items) byId.set(retainedId(item), item);
  return [...byId.values()];
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
  // Captured here so a scan or explicit rebind that lands mid-publish cannot redirect
  // this attempt, and so the live selection is never consulted.
  const intent = latest;
  // The stored key is the destination. A live selection is not consulted, and a
  // destination object that no longer matches its key is not published.
  const project = intent && intent.destinationKey === destinationKey({ kind: "bound", projectId: String(intent.destination?.id) })
    ? intent.destination
    : null;
  if (!project || !intent) return;
  const { root, digest } = intent;
  const facts = buildWorkspaceFacts(digest, await workspaceSymbolIndex(root).filesUnder());
  const state = await readState(root);
  const previous = state[String(project.id)] ?? {};
  const next: Record<string, string> = {};
  const unacked: RetainedFact[] = [];
  for (const fact of facts) {
    const hash = hashOf(fact.content);
    if (previous[fact.key] === hash || (await rememberProjectFact(secrets, project.id, fact.key, fact.content))) {
      next[fact.key] = hash;
    } else {
      unacked.push({ projectId: project.id, key: fact.key, hash, op: "remember", content: fact.content });
    }
  }
  const current = new Set(facts.map((f) => f.key));
  for (const [key, hash] of Object.entries(previous)) {
    if (current.has(key) || !key.startsWith(WORKSPACE_FACT_PREFIX)) continue;
    if (await forgetProjectFact(secrets, project.id, key)) continue;
    // Kept in the state when the delete fails, so the next sync retries the retirement.
    next[key] = hash;
    unacked.push({ projectId: project.id, key, hash, op: "forget", content: "" });
  }
  const covered = new Set(unacked.map(retainedId));
  const kept: RetainedFact[] = [];
  for (const item of await readRetained(root)) {
    if (item.projectId !== project.id) {
      kept.push(item);
      continue;
    }
    if (covered.has(retainedId(item)) || (item.op === "remember" && current.has(item.key))) continue;
    const ok = item.op === "forget"
      ? await forgetProjectFact(secrets, item.projectId, item.key)
      : await rememberProjectFact(secrets, item.projectId, item.key, item.content);
    if (ok) {
      if (item.op === "remember") next[item.key] = item.hash;
    } else {
      kept.push(item);
      unacked.push(item);
    }
  }
  state[String(project.id)] = next;
  try {
    await fs.mkdir(path.dirname(statePath(root)), { recursive: true });
    await fs.writeFile(statePath(root), JSON.stringify(state, null, 2), "utf-8");
  } catch {
    /* an unwritable state file only means the next sync re-checks every fact */
  }
  const retain = retainUnackedFacts();
  try {
    await writeRetained(root, dedupeRetained(retain ? [...kept, ...unacked] : kept));
  } catch {
    /* the omitted hash is still a retry signal; the retained file is the payload */
  }
  if (retain && unacked.length > 0) throw new Error("BuilderForce workspace facts not acknowledged");
}

/** Publish the snapshotted digest. A project-selection change is not a rebind. Serialized. */
export function syncWorkspaceFacts(secrets: vscode.SecretStorage): Promise<void> {
  const attempt = queue.then(() => publish(secrets), () => publish(secrets));
  // A failed publish must not stall the next sync, and must not be reported as acknowledged.
  queue = attempt.then(
    () => undefined,
    (e) => {
      console.error("BuilderForce workspace facts sync failed:", e);
    },
  );
  return attempt;
}

/**
 * The scan's follow-through: warm the definition index (so the first `find_symbol` is
 * instant rather than a cold walk), then publish the digest built from it.
 */
export async function afterWorkspaceScan(secrets: vscode.SecretStorage, root: string, scan: ScanResult): Promise<void> {
  // Before any await: a selection change during the index refresh must not redirect this digest.
  const captured = snapshotSelection(getSelectedProject());
  await workspaceSymbolIndex(root).refresh();
  // The rescan's fresh index belongs in the stable grounding: recompute it on the next turn.
  invalidateStableGrounding();
  latest = {
    root,
    digest: { manifests: scan.manifests, overview: scan.overview, packages: await readPackages(root, scan.manifests) },
    ...captured,
  };
  await syncWorkspaceFacts(secrets);
}
