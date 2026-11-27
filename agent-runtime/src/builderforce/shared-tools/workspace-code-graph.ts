/**
 * The `code_analysis` tool's facts, read through THE repo map (`@builderforce/repo-map`):
 * the file reference graph (dependencies / dependents / impact radius) comes from its
 * {@link RepoGraph}; the per-file definitions (functions, classes, interfaces, exports) come
 * from the one shared symbol extractor the map itself is built on. This replaced the
 * TypeScript-compiler code map (`ast-parser.ts` + `code-map.ts`).
 */

import { matchGlob } from "@builderforce/agent-tools/glob";
import { isIndexedDirName } from "@builderforce/agent-tools/skip-dirs";
import { extractSymbols, symbolLanguageOf, type CodeSymbol } from "@builderforce/agent-tools/symbols";
import { isMapCandidate, RepoGraph, repoMapPort } from "@builderforce/repo-map";
import fs from "node:fs/promises";
import path from "node:path";

export interface WorkspaceCodeFile {
  /** Absolute path (the platform's separators), as the tool has always reported it. */
  path: string;
  language: string;
  functions: number;
  classes: number;
  interfaces: number;
}

export interface WorkspaceCodeExport {
  name: string;
  kind: string;
  file: string;
}

export interface WorkspaceCodeNode {
  file: string;
  dependencies: number;
  dependents: number;
}

export interface WorkspaceCodeGraph {
  files: WorkspaceCodeFile[];
  exports: WorkspaceCodeExport[];
  /** One node per file, in the order the files were read. */
  nodes: WorkspaceCodeNode[];
  /** Total file-to-file dependency edges. */
  dependencyCount: number;
}

/** Every file under `root` (repo-relative, `/`-separated) matching any of `patterns`. */
async function matchingFiles(root: string, patterns: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  async function walk(dirRel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(path.join(root, dirRel), { withFileTypes: true });
    } catch {
      return; // an unreadable directory is skipped, as the walk always did
    }
    for (const entry of entries) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (isIndexedDirName(entry.name)) await walk(rel);
      } else if (entry.isFile() && patterns.some((p) => matchGlob(rel, p))) {
        found.add(rel);
      }
    }
  }
  await walk("");
  return [...found];
}

const isTopLevelExport = (s: CodeSymbol): boolean => s.exported && !s.container && s.kind !== "method";

export async function analyzeWorkspaceCode(root: string, patterns: readonly string[]): Promise<WorkspaceCodeGraph> {
  const builder = repoMapPort.create();
  const files: WorkspaceCodeFile[] = [];
  const exports: WorkspaceCodeExport[] = [];
  const read: string[] = [];
  for (const rel of await matchingFiles(root, patterns)) {
    const abs = path.join(root, rel);
    try {
      const { size } = await fs.stat(abs);
      if (!repoMapPort.accepts(rel, size)) continue;
      const content = await fs.readFile(abs, "utf-8");
      if (!builder.addFile(rel, content)) continue;
      const symbols = extractSymbols(rel, content);
      const count = (kind: string): number => symbols.filter((s) => s.kind === kind).length;
      files.push({
        path: abs,
        language: symbolLanguageOf(rel) ?? "unknown",
        functions: count("function"),
        classes: count("class"),
        interfaces: count("interface"),
      });
      for (const s of symbols) if (isTopLevelExport(s)) exports.push({ name: s.name, kind: s.kind, file: abs });
      read.push(rel);
    } catch {
      // a file that cannot be read or parsed is skipped, as before
    }
  }
  const repo = RepoGraph.fromJSON(builder.build());
  const nodes: WorkspaceCodeNode[] = [];
  let dependencyCount = 0;
  for (const rel of read) {
    const i = repo.graph.indexOf(rel);
    if (i === undefined) continue;
    const dependencies = repo.graph.dependencies(i).length;
    dependencyCount += dependencies;
    nodes.push({ file: path.join(root, rel), dependencies, dependents: repo.graph.dependents(i).length });
  }
  return { files, exports, nodes, dependencyCount };
}
