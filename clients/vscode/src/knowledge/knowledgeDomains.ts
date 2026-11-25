/**
 * Organize by domain, the host's side: the proposal for one folder (from the stored graph), and applying the
 * domains the person accepted — files moved with git, the relative imports of the moved files and of their
 * importers rewritten (`rewriteRelativeImports`).
 *
 * The view sends a `rootId`, a folder and domain ids, never paths: the layout is recomputed here, every id must
 * name a domain of it, every path is re-checked to stay inside the root, and the move count is capped.
 * Only the importers the graph's file edges name are read, not the whole workspace.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { DOMAIN_ID, KEEP_AT_ROOT, domainInputOf, proposeDomainLayout, rewriteRelativeImports } from "@builderforce/agent-tools/knowledge";
import type { DomainLayout, DomainLayoutInput, DomainMove } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { assertInsideRoot, isSafeRelative } from "./knowledgeFixPaths";
import { fixText } from "./knowledgeFixText";

export const MAX_DOMAIN_MOVES = 2000;

/** Package fields whose files are entry points and must not move. */
const ENTRY_FIELDS = ["main", "module", "types", "exports", "bin"] as const;
const WRITTEN_TO_SOURCE: Record<string, readonly string[]> = { ".js": [".ts", ".tsx"], ".mjs": [".mts"] };

export interface DomainPorts {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  /** `git mv`; the target's folder is made first. */
  move(from: string, to: string): Promise<void>;
}

/** What accepting some domains does: the moves, and every path they touch (old and new, plus the importers rewritten). */
export interface DomainPlan {
  moves: DomainMove[];
  /** Root-relative files whose text may change: the moved files (at their old path) and their importers. */
  rewrite: string[];
  /** Every path the apply may leave changed: old and new path of each move, and the importers. */
  wanted: Set<string>;
}

/** Every string leaf of a package.json entry field. */
function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [];
}

/** Base names the root's package.json names as entries (and their TypeScript sources), kept where they are. */
async function entryBasenames(rootPath: string): Promise<string[]> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(rootPath, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    // error-logging: no readable package.json means no entries to keep; the default entry names still apply
    return [];
  }
  return ENTRY_FIELDS.flatMap((field) => leaves(manifest[field])).flatMap((entry) => {
    const name = basename(entry);
    const ext = name.slice(name.lastIndexOf("."));
    return [name, ...(WRITTEN_TO_SOURCE[ext] ?? []).map((source) => name.slice(0, -ext.length) + source)];
  });
}

/** The layout input of one folder, the folder checked to stay inside the root. */
export async function rootDomainInput(graph: KnowledgeGraph, rootId: string, folder: string, rootPath: string): Promise<DomainLayoutInput> {
  const clean = folder.replace(/\\/g, "/").replace(/\/+$/, "");
  if (clean !== "") {
    if (!isSafeRelative(clean)) throw new Error(fixText.outsideFolder(folder));
    await assertInsideRoot(rootPath, `${clean}/_`);
  }
  return { ...domainInputOf(graph, rootId, clean), keepAtRoot: [...KEEP_AT_ROOT, ...(await entryBasenames(rootPath))] };
}

export async function rootDomainLayout(graph: KnowledgeGraph, rootId: string, folder: string, rootPath: string): Promise<DomainLayout> {
  return proposeDomainLayout(await rootDomainInput(graph, rootId, folder, rootPath));
}

/** The moves of the accepted domains and the paths they touch; throws (nothing moved) on an unknown id, no file, too many, or a path that leaves the root. */
export function planDomainMoves(input: DomainLayoutInput, layout: DomainLayout, accept: readonly string[]): DomainPlan {
  const known = new Set(layout.domains.map((d) => d.id));
  for (const id of accept) {
    if (!DOMAIN_ID.test(id) || !known.has(id)) throw new Error(fixText.domainUnknown(id));
  }
  const chosen = new Set(accept);
  const moves = layout.moves.filter((m) => chosen.has(m.domain));
  if (moves.length === 0) throw new Error(fixText.domainsNothing());
  if (moves.length > MAX_DOMAIN_MOVES) throw new Error(fixText.domainsTooMany(moves.length, MAX_DOMAIN_MOVES));
  for (const m of moves) {
    for (const path of [m.from, m.to]) if (!isSafeRelative(path)) throw new Error(fixText.outsideFolder(path));
  }
  const moved = new Set(moves.map((m) => m.from));
  const importers = input.edges.filter((e) => moved.has(e.to)).map((e) => e.from);
  const rewrite = [...new Set([...moved, ...importers])].sort();
  return { moves, rewrite, wanted: new Set([...rewrite, ...moves.map((m) => m.to)]) };
}

/**
 * Reads the files to rewrite once, rewrites them in memory, moves the files, then writes the changed texts
 * (at the new path for a moved file). `files` is every file of the root before the move.
 */
export async function organizeDomains(ports: DomainPorts, plan: DomainPlan, files: ReadonlySet<string>): Promise<{ changed: string[]; rewritten: number }> {
  const moved = new Map(plan.moves.map((m) => [m.from, m.to]));
  const texts = await Promise.all(plan.rewrite.map((path) => ports.read(path)));
  const updated = new Map<string, string>();
  plan.rewrite.forEach((path, i) => {
    const out = rewriteRelativeImports(path, texts[i]!, moved, files);
    if (out.changed > 0) updated.set(moved.get(path) ?? path, out.text);
  });
  // One at a time: git holds an index lock per `mv`.
  for (const m of plan.moves) await ports.move(m.from, m.to);
  await Promise.all([...updated].map(([path, text]) => ports.write(path, text)));
  return { changed: [...plan.wanted], rewritten: updated.size };
}

/** The file ports of a root over node's fs (each path kept inside the root) and the fix flow's `move`. */
export function nodeDomainPorts(rootPath: string, move: (from: string, to: string) => Promise<void>): DomainPorts {
  return {
    async read(path) {
      await assertInsideRoot(rootPath, path);
      return readFile(join(rootPath, path), "utf8");
    },
    async write(path, text) {
      await assertInsideRoot(rootPath, path);
      await writeFile(join(rootPath, path), text, "utf8");
    },
    move,
  };
}
