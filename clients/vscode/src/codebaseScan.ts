import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { complete } from "./gateway";

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "out", "build", ".next", "coverage", ".turbo",
  ".vscode-test", "vendor", ".venv", "venv", "__pycache__", ".cache", "target", ".idea",
]);
const MANIFEST_FILES = new Set([
  "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod",
  "pom.xml", "build.gradle", "Gemfile", "composer.json", "wrangler.toml",
]);
const MAX_DIRS = 3000;
const MAX_DEPTH = 6;
const MAX_ROOT_FILES = 200;

interface ScanData {
  dirs: string[];
  manifests: string[];
  /** Notable shallow files: every file at the workspace root plus docs (*.md) one
   *  level down. Gives the grounding map an actual FILE index so a root-level doc
   *  (ROADMAP.md, README, a PRD) is discoverable — without it the model can wrongly
   *  conclude a file it was asked about does not exist. */
  rootFiles: string[];
  extCounts: Map<string, number>;
  fileCount: number;
  truncated: boolean;
}

interface ScanCache {
  versionToken: string;
  grounding: string;
  generatedAt: string;
}

function isManifest(name: string): boolean {
  return MANIFEST_FILES.has(name) || name.endsWith(".csproj") || name.endsWith(".sln");
}

async function scanTree(root: string): Promise<ScanData> {
  const dirs: string[] = [];
  const manifests: string[] = [];
  const rootFiles: string[] = [];
  const extCounts = new Map<string, number>();
  let fileCount = 0;
  let truncated = false;

  async function rec(abs: string, rel: string, depth: number): Promise<void> {
    if (dirs.length > MAX_DIRS) {
      truncated = true;
      return;
    }
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        dirs.push(childRel);
        if (depth < MAX_DEPTH) await rec(path.join(abs, e.name), childRel, depth + 1);
      } else if (e.isFile()) {
        fileCount++;
        const ext = path.extname(e.name).toLowerCase() || "(none)";
        extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
        if (isManifest(e.name)) manifests.push(rel ? `${rel}/${e.name}` : e.name);
        // Index every root file, plus docs (*.md) one level down, so top-level
        // documents are named in the map (not just counted).
        if (rootFiles.length < MAX_ROOT_FILES && (depth === 0 || (depth === 1 && ext === ".md"))) {
          rootFiles.push(rel ? `${rel}/${e.name}` : e.name);
        }
      }
    }
  }

  await rec(root, "", 0);
  return { dirs, manifests, rootFiles, extCounts, fileCount, truncated };
}

/** Version token from the directory structure + manifest set (changes on structural edits). */
function computeToken(data: ScanData): string {
  const h = crypto.createHash("sha256");
  for (const d of [...data.dirs].sort()) h.update(`d:${d}\n`);
  for (const m of [...data.manifests].sort()) h.update(`m:${m}\n`);
  for (const f of [...data.rootFiles].sort()) h.update(`f:${f}\n`);
  return h.digest("hex").slice(0, 32);
}

function topExts(extCounts: Map<string, number>, n = 10): string {
  return [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([e, c]) => `${e}:${c}`)
    .join(", ");
}

/** Indented tree from a flat list of relative dir paths, bounded by depth + line count. */
function renderTree(dirs: string[], maxDepth: number, maxLines: number): string {
  const shown = dirs
    .filter((d) => d.split("/").length <= maxDepth)
    .sort()
    .slice(0, maxLines);
  const lines = shown.map((d) => {
    const parts = d.split("/");
    return `${"  ".repeat(parts.length - 1)}${parts[parts.length - 1]}/`;
  });
  if (dirs.length > shown.length) lines.push(`… (${dirs.length - shown.length} more directories)`);
  return lines.join("\n");
}

function renderMap(
  data: ScanData,
  root: string,
  opts: { treeDepth: number; treeLines: number; maxManifests: number; maxRootFiles: number },
): string {
  const out: string[] = [];
  out.push(`Workspace: ${path.basename(root)}`);
  out.push(`Files: ${data.fileCount}${data.truncated ? "+" : ""} · Top file types: ${topExts(data.extCounts)}`);
  if (data.manifests.length) {
    out.push("");
    out.push("Sub-projects (each directory below contains a manifest — this is where distinct apps/packages live):");
    for (const m of [...data.manifests].sort().slice(0, opts.maxManifests)) {
      const dir = path.dirname(m);
      out.push(`- ${dir === "." ? "(root)" : dir}  [${path.basename(m)}]`);
    }
    if (data.manifests.length > opts.maxManifests) {
      out.push(`- … (${data.manifests.length - opts.maxManifests} more)`);
    }
  }
  if (data.rootFiles.length) {
    out.push("");
    out.push("Top-level files (name a file directly with read_file; use list_files with a `glob` to find others):");
    for (const f of [...data.rootFiles].sort().slice(0, opts.maxRootFiles)) {
      out.push(`- ${f}`);
    }
    if (data.rootFiles.length > opts.maxRootFiles) {
      out.push(`- … (${data.rootFiles.length - opts.maxRootFiles} more)`);
    }
  }
  out.push("");
  out.push("Directory tree:");
  out.push(renderTree(data.dirs, opts.treeDepth, opts.treeLines));
  return out.join("\n");
}

function buildContextYaml(data: ScanData, root: string): string {
  const langs = topExts(data.extCounts, 8);
  const subs = [...new Set(data.manifests.map((m) => path.dirname(m)))].sort().slice(0, 60);
  return [
    `project: ${path.basename(root)}`,
    `files: ${data.fileCount}${data.truncated ? "+" : ""}`,
    `languages: "${langs}"`,
    `subProjects:`,
    ...subs.map((s) => `  - ${s === "." ? "(root)" : s}`),
  ].join("\n");
}

/**
 * Scan + ground the workspace. Writes an on-prem-style `.builderforce/` directory
 * (context.yaml, project-map.md, architecture.md, memory/, README) and returns a COMPACT
 * grounding string (deterministic directory map + sub-project list + a short overview)
 * injected into the agent so it can locate files WITHOUT walking the tree. Read-through
 * cached by a structure version token; the expensive walk + one summary call only run on
 * a token miss or `force`.
 */
export async function scanCodebase(
  secrets: vscode.SecretStorage,
  root: string,
  model: string | undefined,
  force = false,
): Promise<string | undefined> {
  const bfDir = path.join(root, ".builderforce");
  const cachePath = path.join(bfDir, "scan.json");

  const data = await scanTree(root);
  const versionToken = computeToken(data);

  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf-8")) as ScanCache;
      if (cached.versionToken === versionToken && cached.grounding) return cached.grounding;
    } catch {
      /* recompute */
    }
  }

  // Compact map = what we inject into the agent (token-bounded, high-signal).
  const compactMap = renderMap(data, root, { treeDepth: 3, treeLines: 200, maxManifests: 120, maxRootFiles: 60 });
  // Full map = written to disk for the human.
  const fullMap = renderMap(data, root, { treeDepth: MAX_DEPTH, treeLines: 2000, maxManifests: 400, maxRootFiles: MAX_ROOT_FILES });

  // Best-effort one-shot overview (skipped silently if the call fails, e.g. quota).
  let overview = "";
  try {
    overview = await complete(
      secrets,
      [
        {
          role: "system",
          content:
            "You summarize a codebase for an AI coding agent in <=100 words: what it is, the main languages/frameworks, and what each top sub-project is for. No preamble, plain prose.",
        },
        { role: "user", content: `Project map:\n\n${compactMap}` },
      ],
      model,
    );
  } catch {
    /* grounding still works from the deterministic map */
  }

  const grounding = [
    "## Project map",
    compactMap,
    overview.trim() ? `\n## Overview\n${overview.trim()}` : "",
  ]
    .join("\n")
    .slice(0, 8000);

  // Write the on-prem-style .builderforce/ structure.
  await fs.mkdir(path.join(bfDir, "memory"), { recursive: true });
  await fs.writeFile(path.join(bfDir, "context.yaml"), buildContextYaml(data, root) + "\n", "utf-8");
  await fs.writeFile(
    path.join(bfDir, "project-map.md"),
    `# Project map (auto-generated by BuilderForce)\n\n${fullMap}\n`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(bfDir, "architecture.md"),
    `# Architecture (auto-generated by BuilderForce)\n\n${overview.trim() || "_Overview unavailable (offline or quota); see project-map.md for structure._"}\n`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(bfDir, "README.md"),
    "# .builderforce\n\nWorkspace knowledge the BuilderForce agent uses for grounding:\n\n- `context.yaml` — detected languages + sub-projects\n- `project-map.md` — full directory map\n- `architecture.md` — overview summary\n- `memory/` — session knowledge appended over time\n- `scan.json` — scan cache (version-token keyed)\n\nSafe to commit or gitignore.\n",
    "utf-8",
  );
  await fs.writeFile(path.join(bfDir, "memory", ".gitkeep"), "", "utf-8");

  const cache: ScanCache = { versionToken, grounding, generatedAt: new Date().toISOString() };
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  return grounding;
}
