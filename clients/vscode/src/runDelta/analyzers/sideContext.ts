/**
 * What every analyzer of one repository's L3 run shares (PRD 41 §B7, C9): the ONE file universe (git's file list of the
 * working tree, and the folders it ignores, so both sides measure the same files), the configuration read from the BEFORE
 * side (the layer registry, gitleaks' config and ignore list, the repository's Semgrep rules — a run cannot loosen what
 * judges it, as with `.builderforce/delta.json`), and the content hash of a tool's declared input files on each side
 * (the cache key's input set).
 *
 * A file's BEFORE text: an in-run changed file's before side (absent when the run created it); any other file is the same
 * on both sides (outside-run changes are not the run's), so the working tree's.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CODE_PARTITIONS_FILE, loadCodePartitions } from "@builderforce/agent-tools/knowledge";
import type { SideText, UnresolvedFile } from "@builderforce/run-delta";
import type { PartitionRegistry } from "@seanhogg/builderforce-memory/knowledge";
import type { PreparedDelta } from "../preparedPorts";
import { sha256 } from "./analyzerCache";
import { ignoredFolders, treeFiles } from "./beforeTree";

const GITLEAKS_CONFIG = ".gitleaks.toml";
const GITLEAKS_IGNORE = ".gitleaksignore";
/** The repository's own Semgrep rules, first found wins. */
const SEMGREP_CONFIGS = [".semgrep.yml", ".semgrep.yaml", "semgrep.yml"];

export interface RunContext {
  root: string;
  /** git's file list of the working tree; undefined when git cannot list it. */
  universe: string[] | undefined;
  /** Folders git ignores in the working tree. */
  ignored: string[];
  /** Configuration as of the BEFORE side. */
  before: { partitions?: PartitionRegistry; gitleaks?: { config?: string; ignore?: string }; semgrep?: { config: string } };
  /** Hash of the configuration every key shares (ignored folders, layer registry). */
  configHash: string;
  /** A root-relative file's text on one side; undefined when absent there. */
  textOf(side: "before" | "after", rel: string): Promise<string | undefined>;
}

const isText = (v: SideText | UnresolvedFile | undefined): v is SideText => !!v && !("reason" in v);

export async function runContextOf(root: string, prepared: Pick<PreparedDelta, "input" | "texts">): Promise<RunContext> {
  const before = new Map(prepared.texts.before);
  const inRun = new Map(prepared.input.files.filter((f) => f.attribution !== "outside-run").map((f) => [f.path, f]));
  const working = (rel: string) => fs.readFile(path.join(root, rel), "utf8").catch(() => undefined);
  const textOf = async (side: "before" | "after", rel: string): Promise<string | undefined> => {
    const f = inRun.get(rel);
    if (side === "after" || !f) return working(rel);
    if (f.beforeHash === undefined) return undefined; // the run created it
    const b = before.get(rel);
    return isText(b) ? b.text : working(rel); // an unreadable before side keeps the working bytes (its findings are `present`)
  };
  const [universe, ignored] = await Promise.all([treeFiles(root), ignoredFolders(root)]);
  const partitionsText = await textOf("before", CODE_PARTITIONS_FILE);
  let partitions: PartitionRegistry | undefined;
  try { partitions = loadCodePartitions(partitionsText); } catch { partitions = loadCodePartitions(); }
  const [config, ignore] = await Promise.all([textOf("before", GITLEAKS_CONFIG), textOf("before", GITLEAKS_IGNORE)]);
  let semgrep: string | undefined;
  for (const name of SEMGREP_CONFIGS) if ((semgrep = await textOf("before", name)) !== undefined) break;
  return {
    root, universe, ignored,
    before: {
      partitions,
      ...(config !== undefined || ignore !== undefined ? { gitleaks: { ...(config !== undefined ? { config } : {}), ...(ignore !== undefined ? { ignore } : {}) } } : {}),
      ...(semgrep !== undefined ? { semgrep: { config: semgrep } } : {}),
    },
    configHash: sha256(JSON.stringify({ ignored, partitions: partitionsText ?? null })),
    textOf,
  };
}

/** The hash of every universe file whose basename the tool declares (lockfiles, manifests, its config), on one side. */
export async function inputsHash(ctx: RunContext, side: "before" | "after", basenames: readonly string[] | undefined): Promise<string> {
  if (!basenames || basenames.length === 0) return "";
  const wanted = new Set(basenames);
  const files = (ctx.universe ?? []).filter((p) => wanted.has(p.slice(p.lastIndexOf("/") + 1))).sort();
  const parts: string[] = [];
  for (const p of files) parts.push(`${p}\u0000${sha256((await ctx.textOf(side, p)) ?? "\u0000absent")}`);
  return sha256(parts.join("\n"));
}
