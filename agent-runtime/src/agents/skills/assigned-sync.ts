/**
 * Mirror the skills Builderforce ASSIGNED anywhere on this host onto disk, as real
 * Agent Skills folders the loader then discovers like any other — and decide, per run,
 * which of them that run may load.
 *
 * `artifacts.sync` used to record assigned skill slugs and hope: its own comment said
 * "actual skill files are expected to already be present on the agentNode". A
 * marketplace or workspace skill assigned in the portal therefore reached an on-prem
 * agent as a name it was told to look for and usually could not find.
 *
 * Now the managed skills dir mirrors what this host needs, which is the union of two lists:
 *   • the host listing from the gateway (`GET /llm/v1/skills/host`): every skill granted
 *     to this host, its agents or the workspace, with when each last changed;
 *   • every LIVE run's own assignment (the per-run sidecars). This covers task-scoped
 *     skills, which reach a run but are not host grants.
 * A new or changed skill is fetched (`GET /llm/v1/skills/:name/package`, the same skill
 * library every cloud surface reads) and written with its bundled scripts, references
 * and binary assets. An unchanged listed one is left as is. One neither list claims is
 * removed, so no in-flight run loses a skill it is using. A run-only skill carries no
 * `updatedAt`, so it is re-fetched on every sync of a run that names it: a task skill
 * edited mid-ticket reaches the ticket's next run, at the cost of one fetch per run.
 * Which mirrored skills a run loads is its own sidecar, applied by
 * {@link filterSyncedSkillsForRun}, so a skill assigned for one project never leaks into
 * another project's run on the same machine.
 *
 * Two rules keep this from damaging a machine:
 *   • Every fetched folder goes through `@builderforce/agent-skills` first — paths are
 *     normalised and held inside the skill folder, sizes are bounded — before a single
 *     byte is written. The gateway is trusted; the rule does not depend on that.
 *   • A folder this module did not write is never touched. Synced folders carry a
 *     `.builderforce-assigned` marker (a dotfile, so the loader ignores it) recording
 *     the version written; a same-named skill the user made themselves wins, and is
 *     reported as skipped. Pruning happens only after the host listing was READ — a
 *     gateway outage never empties the dir.
 */

import fs from "node:fs";
import path from "node:path";
import { readSkillPackage, writeSkillPackage, type SkillFile } from "@builderforce/agent-skills";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { CONFIG_DIR } from "../../utils.js";
import { liveRunAssignedSkills, readAssignedArtifactSlugsSync } from "../assigned-artifacts-sidecar.js";

const MARKER = ".builderforce-assigned";
const FETCH_TIMEOUT_MS = 15_000;

export interface AssignedSkillSyncResult {
  /** Fetched and (re)written this sync. */
  written: string[];
  /** Already on disk at the listed version. */
  unchanged: string[];
  /** Synced folders removed because the host is no longer assigned them. */
  removed: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

export interface AssignedSkillSyncOptions {
  /** Where synced skills land. Default: the managed skills dir (`<config>/skills`). */
  managedSkillsDir?: string;
  fetchImpl?: typeof fetch;
  /** Gateway + key. Default: `BUILDERFORCE_URL` / `BUILDERFORCE_API_KEY`. */
  gateway?: { base: string; apiKey: string };
  /** The syncing run's own assigned skills (may include task-scoped ones the host listing lacks). */
  runSkills?: readonly string[];
  /** Where the per-run sidecars live, for the live-run union. Default: `<config>/run-artifacts`. */
  runArtifactsDir?: string;
}

interface HostSkill {
  name: string;
  updatedAt: string;
}

function resolveGateway(): { base: string; apiKey: string } | null {
  const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  if (!apiKey) return null;
  const base = (readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai").replace(/\/+$/, "");
  return { base, apiKey };
}

async function getJson(
  gateway: { base: string; apiKey: string },
  route: string,
  fetchImpl: typeof fetch,
): Promise<unknown | string> {
  try {
    const res = await fetchImpl(`${gateway.base}${route}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${gateway.apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return `gateway returned ${res.status}`;
    return await res.json();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function fetchHostListing(gateway: { base: string; apiKey: string }, fetchImpl: typeof fetch): Promise<HostSkill[] | string> {
  const body = await getJson(gateway, "/llm/v1/skills/host", fetchImpl);
  if (typeof body === "string") return body;
  const skills = (body as { skills?: unknown }).skills;
  if (!Array.isArray(skills)) return "gateway returned no host listing";
  return skills.flatMap((s) => {
    const name = typeof (s as HostSkill)?.name === "string" ? (s as HostSkill).name.trim() : "";
    const updatedAt = typeof (s as HostSkill)?.updatedAt === "string" ? (s as HostSkill).updatedAt : "";
    return name ? [{ name, updatedAt }] : [];
  });
}

async function fetchPackage(gateway: { base: string; apiKey: string }, slug: string, fetchImpl: typeof fetch): Promise<SkillFile[] | string> {
  const body = await getJson(gateway, `/llm/v1/skills/${encodeURIComponent(slug)}/package`, fetchImpl);
  if (typeof body === "string") return body;
  const files = (body as { files?: unknown }).files;
  return Array.isArray(files) ? (files as SkillFile[]) : "gateway returned no files";
}

/** The version this module wrote into `folder`, `""` for an older marker, `null` when it did not write it. */
function syncedVersion(folder: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(folder, MARKER), "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown };
    return typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
  } catch {
    return ""; // a pre-listing marker (a bare timestamp): ours, version unknown
  }
}

/** Write one validated folder under `dir/<name>/`, replacing a previous sync of it. */
function writeFolder(dir: string, name: string, files: SkillFile[], updatedAt: string): void {
  const target = path.join(dir, name);
  fs.rmSync(target, { recursive: true, force: true });
  for (const file of files) {
    const dest = path.join(target, ...file.path.split("/"));
    // Belt to the package's braces: never write outside the skill folder.
    if (!dest.startsWith(target + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (file.encoding === "base64") fs.writeFileSync(dest, Buffer.from(file.content, "base64"));
    else fs.writeFileSync(dest, file.content, "utf-8");
  }
  fs.writeFileSync(path.join(target, MARKER), `${JSON.stringify({ updatedAt, syncedAt: new Date().toISOString() })}\n`, "utf-8");
}

/** Remove folders this module wrote whose skill the host is no longer assigned. */
function pruneUnassigned(dir: string, keep: ReadonlySet<string>): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    const folder = path.join(dir, entry.name);
    if (syncedVersion(folder) === null) continue;
    fs.rmSync(folder, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

/**
 * Bring the managed skills dir in line with the host listing UNION every live run's
 * assignment: fetch what is new or changed, keep what is current, remove what neither
 * claims. Never throws: each failure is a `skipped` entry, and nothing is removed unless
 * the listing was read.
 */
export async function syncAssignedSkills(options: AssignedSkillSyncOptions = {}): Promise<AssignedSkillSyncResult> {
  const result: AssignedSkillSyncResult = { written: [], unchanged: [], removed: [], skipped: [] };
  const dir = options.managedSkillsDir ?? path.join(CONFIG_DIR, "skills");
  const gateway = options.gateway ?? resolveGateway();
  if (!gateway) {
    result.skipped.push({ slug: "*", reason: "BUILDERFORCE_API_KEY is not set" });
    return result;
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  // Without the listing the run's own skills are still fetched, but nothing is removed:
  // an outage must never empty the dir under another run.
  const fetchedListing = await fetchHostListing(gateway, fetchImpl);
  const listingRead = typeof fetchedListing !== "string";
  if (!listingRead) result.skipped.push({ slug: "*", reason: `host skill listing unavailable: ${fetchedListing}` });
  const listing = listingRead ? fetchedListing : [];

  // Run-only skills (task-scoped: on a run's list, not the host's) join the fetch set with
  // no version, so they are always refreshed (see the header).
  const listed = new Set(listing.map((s) => s.name));
  const runOnly = [...new Set((options.runSkills ?? []).map((s) => s.trim()).filter((s) => s && !listed.has(s)))];
  const wanted: HostSkill[] = [...listing, ...runOnly.map((name) => ({ name, updatedAt: "" }))];

  for (const { name, updatedAt } of wanted) {
    const existing = path.join(dir, name);
    const version = syncedVersion(existing);
    if (version === null && fs.existsSync(existing)) {
      result.skipped.push({ slug: name, reason: `a local skill named "${name}" already exists and takes precedence` });
      continue;
    }
    if (version !== null && version !== "" && version === updatedAt) {
      result.unchanged.push(name);
      continue;
    }
    const fetched = await fetchPackage(gateway, name, fetchImpl);
    if (typeof fetched === "string") {
      // A still-assigned skill the gateway cannot serve right now keeps its last good copy.
      result.skipped.push({ slug: name, reason: fetched });
      continue;
    }
    const read = readSkillPackage(fetched, { directoryName: name });
    if (!read.package) {
      result.skipped.push({ slug: name, reason: read.issues.map((i) => i.message).join("; ") || "not a valid skill folder" });
      continue;
    }
    writeFolder(dir, name, writeSkillPackage(read.package), updatedAt);
    result.written.push(name);
  }

  if (listingRead) {
    const keep = new Set([...wanted.map((s) => s.name), ...liveRunAssignedSkills(options.runArtifactsDir)]);
    result.removed = pruneUnassigned(dir, keep);
  }
  return result;
}

/**
 * The per-run half: drop every SYNCED skill (one carrying the marker) that the current
 * run was not assigned. Skills the user wrote, workspace skills and bundled skills pass
 * untouched. The run's list is the `artifacts.sync` sidecar keyed by the run's
 * `workspaceDir`.
 */
export function filterSyncedSkillsForRun<T extends { name: string; baseDir: string }>(
  skills: readonly T[],
  workspaceDir: string,
  runArtifactsDir?: string,
): T[] {
  let assigned: Set<string> | null = null;
  return skills.filter((skill) => {
    if (syncedVersion(skill.baseDir) === null) return true;
    assigned ??= new Set(readAssignedArtifactSlugsSync(workspaceDir, runArtifactsDir).skills.map((s) => s.trim()));
    return assigned.has(skill.name) || assigned.has(path.basename(skill.baseDir));
  });
}
