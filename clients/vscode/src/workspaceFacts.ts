/**
 * The workspace DIGEST as project facts — what the codebase scan learned, written into
 * the shared per-project facts store so `recall_facts` (and every cloud/on-prem run on
 * the project) can answer "where does X live?" from turn one.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * The scan used to produce a directory map for the prompt and nothing else. The facts
 * store — the thing the persona tells the agent to consult BEFORE searching — filled
 * only when a model chose to call `remember_fact`, so on a fresh project `recall_facts`
 * returned nothing and the agent went straight to search-and-read. The editor spec
 * (14-prd-vscode-extension) always meant the scan digest to land in memory; it never did.
 *
 * One fact per sub-project (the directories holding a manifest), naming its main folders
 * and its most-exported modules WITH their exported names — the lexical and semantic
 * hooks a question like "where is the task list built?" recalls on — plus one overview
 * fact. Pure: no `vscode`, no network; `workspaceFactsSync.ts` publishes the result.
 */

import * as path from "path";
import type { CodeSymbol } from "@builderforce/agent-tools";

/** Key prefix every fact this module owns carries — so a sync can retire its own stale keys. */
export const WORKSPACE_FACT_PREFIX = "workspace:";
export const WORKSPACE_OVERVIEW_KEY = `${WORKSPACE_FACT_PREFIX}overview`;

/** Sub-projects given a fact of their own — the largest, by indexed files. */
const MAX_SUBPROJECT_FACTS = 40;
/** A sub-project with fewer indexed files than this is a fixture/config dir, not a module. */
const MIN_SUBPROJECT_FILES = 3;
const MAX_DIRS_PER_FACT = 12;
const MAX_MODULES_PER_FACT = 12;
const MAX_NAMES_PER_MODULE = 8;
const MAX_FACT_CHARS = 1_800;
const MAX_OVERVIEW_CHARS = 3_000;

export interface WorkspaceDigest {
  /** Workspace-relative manifest paths (`api/package.json`, `go.mod`, …). */
  manifests: string[];
  /** The scan's model-written overview, when it has one. */
  overview: string;
  /** Package metadata by sub-project dir, read from its manifest when it has any. */
  packages?: Record<string, { name?: string; description?: string }>;
}

export interface WorkspaceFact {
  key: string;
  content: string;
}

/** An indexed file and its definitions — what the symbol index hands a digest. */
export interface IndexedFile {
  path: string;
  symbols: CodeSymbol[];
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The fact key for a sub-project dir — stable across scans, readable in a recall. */
export function subprojectFactKey(dir: string): string {
  return `${WORKSPACE_FACT_PREFIX}subproject:${dir === "." || dir === "" ? "(root)" : dir}`;
}

/**
 * The sub-projects, deepest-first attribution: a file belongs to the NEAREST manifest dir
 * above it, so `api/` does not also claim everything under `api/container/`.
 */
function assignToSubprojects(dirs: string[], files: IndexedFile[]): Map<string, IndexedFile[]> {
  const byDepth = [...dirs].sort((a, b) => b.split("/").length - a.split("/").length);
  const out = new Map<string, IndexedFile[]>(dirs.map((d) => [d, []]));
  for (const file of files) {
    const owner = byDepth.find((d) => d === "." || file.path === d || file.path.startsWith(`${d}/`));
    if (owner) out.get(owner)!.push(file);
  }
  return out;
}

function describeSubproject(
  dir: string,
  manifests: string[],
  files: IndexedFile[],
  pkg: { name?: string; description?: string } | undefined,
): string {
  const prefix = dir === "." ? "" : `${dir}/`;
  const head = [`Sub-project \`${dir === "." ? "(workspace root)" : dir}\` (${manifests.join(", ")})`];
  if (pkg?.name) head.push(`package "${pkg.name}"${pkg.description ? ` — ${pkg.description}` : ""}`);

  // Main folders, by how much indexed code they hold.
  const folderCounts = new Map<string, number>();
  for (const f of files) {
    const rest = f.path.slice(prefix.length).split("/");
    if (rest.length < 2) continue;
    const folder = rest.length > 2 ? `${rest[0]}/${rest[1]}` : rest[0];
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }
  const folders = [...folderCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_DIRS_PER_FACT)
    .map(([folder, n]) => `${folder} (${n})`);

  // The modules with the most exported definitions — the ones other code depends on.
  const modules = files
    .map((f) => ({ path: f.path, exported: f.symbols.filter((s) => s.exported && s.kind !== "heading").map((s) => s.name) }))
    .filter((m) => m.exported.length > 0)
    .sort((a, b) => b.exported.length - a.exported.length || a.path.localeCompare(b.path))
    .slice(0, MAX_MODULES_PER_FACT)
    .map((m) => `- ${m.path} — ${m.exported.slice(0, MAX_NAMES_PER_MODULE).join(", ")}${m.exported.length > MAX_NAMES_PER_MODULE ? ", …" : ""}`);

  const lines = [`${head.join(": ")}. ${files.length} indexed source file(s).`];
  if (folders.length) lines.push(`Main folders: ${folders.join(", ")}.`);
  if (modules.length) lines.push("Key modules (most exported definitions):", ...modules);
  lines.push("Use find_symbol to locate any definition by name, and file_outline before reading a large file.");
  return clip(lines.join("\n"), MAX_FACT_CHARS);
}

/** The facts a workspace digest produces: one overview plus one per significant sub-project. */
export function buildWorkspaceFacts(digest: WorkspaceDigest, files: IndexedFile[]): WorkspaceFact[] {
  const manifestsByDir = new Map<string, string[]>();
  for (const m of digest.manifests) {
    const dir = path.posix.dirname(m.split("\\").join("/"));
    const list = manifestsByDir.get(dir) ?? [];
    list.push(path.posix.basename(m));
    manifestsByDir.set(dir, list);
  }
  const assigned = assignToSubprojects([...manifestsByDir.keys()], files);
  const significant = [...assigned.entries()]
    .filter(([, owned]) => owned.length >= MIN_SUBPROJECT_FILES)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_SUBPROJECT_FACTS);

  const facts: WorkspaceFact[] = significant.map(([dir, owned]) => ({
    key: subprojectFactKey(dir),
    content: describeSubproject(dir, manifestsByDir.get(dir) ?? [], owned, digest.packages?.[dir]),
  }));

  const overview = [
    digest.overview.trim() ? `Workspace overview: ${digest.overview.trim()}` : "Workspace overview (from the editor's codebase scan).",
    `Sub-projects by size: ${significant.map(([dir, owned]) => `${dir === "." ? "(root)" : dir} (${owned.length} files)`).join(", ") || "none detected"}.`,
    `Each has a "${WORKSPACE_FACT_PREFIX}subproject:<dir>" fact naming its main folders and key modules.`,
  ].join("\n");
  facts.unshift({ key: WORKSPACE_OVERVIEW_KEY, content: clip(overview, MAX_OVERVIEW_CHARS) });
  return facts;
}
