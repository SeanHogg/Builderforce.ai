/**
 * The assigned-artifacts sidecar: the skill/persona/content slugs Builderforce assigned
 * to ONE run, written by the gateway `artifacts.sync` handler and read by the prompt
 * builders and the skill loader.
 *
 * A host runs several tickets at once, each in its own workspace, so the sidecar is
 * keyed by the run's workspace directory — one file per workspace, never a single file
 * per gateway process that concurrent runs would overwrite. It lives under the config
 * dir, NOT inside the workspace: a ticket workspace is a git clone whose every change is
 * committed to the ticket branch, and the sidecar must never ride along.
 *
 * One module owns its location and shape so the writer and every reader agree. It is
 * kept light on purpose: the skill loader reads it synchronously while it builds a
 * run's skill list, and must not pull the persona/limbic stack in with it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";

export type AssignedArtifactSlugs = {
  skills: string[];
  personas: string[];
  content: string[];
};

export interface AssignedArtifactsRecord extends AssignedArtifactSlugs {
  executionId?: number;
  taskId?: number;
}

const EMPTY: AssignedArtifactSlugs = { skills: [], personas: [], content: [] };

/** Where every run's sidecar lives (default: `<config>/run-artifacts`). */
export function runArtifactsDir(): string {
  return path.join(CONFIG_DIR, "run-artifacts");
}

const resolveWorkspace = (workspaceDir?: string): string => path.resolve(workspaceDir ?? process.cwd());

/** The sidecar file for one run workspace (default: the gateway's `process.cwd()`). */
export function assignedArtifactsPath(workspaceDir?: string, dir: string = runArtifactsDir()): string {
  const key = createHash("sha256").update(resolveWorkspace(workspaceDir)).digest("hex").slice(0, 24);
  return path.join(dir, `${key}.json`);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parse(raw: string): AssignedArtifactSlugs & { workspaceDir?: string } {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    return {
      skills: toStringArray(j.skills),
      personas: toStringArray(j.personas),
      content: toStringArray(j.content),
      ...(typeof j.workspaceDir === "string" ? { workspaceDir: j.workspaceDir } : {}),
    };
  } catch {
    return EMPTY;
  }
}

/** Record a run's assignment. Written for an EMPTY one too, so a stale list never lingers. */
export async function writeAssignedArtifactSlugs(
  workspaceDir: string | undefined,
  record: AssignedArtifactsRecord,
  dir: string = runArtifactsDir(),
): Promise<void> {
  const filePath = assignedArtifactsPath(workspaceDir, dir);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  // The sync lands before the run prepares its ticket workspace; create it now (as that
  // preparation does — a clone goes into an existing empty dir fine) so this sidecar
  // counts as a LIVE run's from the first moment (see `liveRunAssignedSkills`).
  await fs.promises.mkdir(resolveWorkspace(workspaceDir), { recursive: true });
  const body = {
    workspaceDir: resolveWorkspace(workspaceDir),
    skills: record.skills,
    personas: record.personas,
    content: record.content,
    executionId: record.executionId,
    taskId: record.taskId,
    syncedAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(filePath, JSON.stringify(body, null, 2), "utf-8");
}

/** Read the slugs `artifacts.sync` recorded for a run workspace. Empty lists when none. */
export async function readAssignedArtifactSlugs(workspaceDir?: string, dir?: string): Promise<AssignedArtifactSlugs> {
  try {
    const { skills, personas, content } = parse(await fs.promises.readFile(assignedArtifactsPath(workspaceDir, dir), "utf-8"));
    return { skills, personas, content };
  } catch {
    return EMPTY;
  }
}

/** Synchronous twin for the (synchronous) skill loader. */
export function readAssignedArtifactSlugsSync(workspaceDir?: string, dir?: string): AssignedArtifactSlugs {
  try {
    const { skills, personas, content } = parse(fs.readFileSync(assignedArtifactsPath(workspaceDir, dir), "utf-8"));
    return { skills, personas, content };
  } catch {
    return EMPTY;
  }
}

/**
 * Every skill some LIVE run on this host was assigned — the union over all sidecars
 * whose workspace still exists. A ticket workspace is removed when its ticket reaches a
 * terminal state (or by the stale sweep), so a finished run stops pinning its skills,
 * and its sidecar is deleted here; an in-flight run's skills are always included.
 */
export function liveRunAssignedSkills(dir: string = runArtifactsDir()): Set<string> {
  const skills = new Set<string>();
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return skills;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    let record: ReturnType<typeof parse>;
    try {
      record = parse(fs.readFileSync(file, "utf-8"));
    } catch {
      continue;
    }
    if (!record.workspaceDir || !fs.existsSync(record.workspaceDir)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    for (const s of record.skills) if (s.trim()) skills.add(s.trim());
  }
  return skills;
}
