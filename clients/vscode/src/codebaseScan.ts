import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { complete } from "./gateway";

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "out", "build", ".next", "coverage", ".turbo",
  ".vscode-test", "vendor", ".venv", "venv", "__pycache__", ".cache", "target", ".idea",
]);
const MAX_FILES = 4000;

interface ScanCache {
  versionToken: string;
  summary: string;
  generatedAt: string;
}

interface WalkResult {
  files: { rel: string; size: number }[];
  truncated: boolean;
}

async function walk(root: string): Promise<WalkResult> {
  const files: { rel: string; size: number }[] = [];
  let truncated = false;

  async function rec(dir: string): Promise<void> {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await rec(abs);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = (await fs.stat(abs)).size;
        } catch {
          /* ignore */
        }
        files.push({ rel: path.relative(root, abs).replace(/\\/g, "/"), size });
      }
    }
  }

  await rec(root);
  return { files, truncated };
}

/** Stable version token: hash of the (path,size) list. Changes on add/remove/resize. */
function computeToken(files: { rel: string; size: number }[]): string {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    h.update(`${f.rel}:${f.size}\n`);
  }
  return h.digest("hex").slice(0, 32);
}

async function readIfExists(abs: string, cap = 4000): Promise<string | undefined> {
  try {
    const txt = await fs.readFile(abs, "utf-8");
    return txt.slice(0, cap);
  } catch {
    return undefined;
  }
}

/** Build a compact structural digest fed to the summarizer (bounded). */
async function buildDigest(root: string, walkRes: WalkResult): Promise<string> {
  const { files, truncated } = walkRes;

  const extCounts = new Map<string, number>();
  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase() || "(none)";
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }
  const topExts = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([e, n]) => `${e}:${n}`)
    .join(", ");

  const topDirs = [...new Set(files.map((f) => f.rel.split("/")[0]))]
    .filter((d) => !d.includes("."))
    .slice(0, 30)
    .join(", ");

  const pkg = await readIfExists(path.join(root, "package.json"), 3000);
  const readme =
    (await readIfExists(path.join(root, "README.md"), 2000)) ??
    (await readIfExists(path.join(root, "readme.md"), 2000));
  const hasTsconfig = files.some((f) => f.rel.endsWith("tsconfig.json"));
  const hasPyproject = files.some((f) => f.rel === "pyproject.toml" || f.rel === "requirements.txt");
  const hasCargo = files.some((f) => f.rel === "Cargo.toml");
  const hasGoMod = files.some((f) => f.rel === "go.mod");

  const sampleFiles = files
    .filter((f) => /\.(ts|tsx|js|jsx|py|go|rs|java|rb|cs)$/.test(f.rel))
    .slice(0, 60)
    .map((f) => f.rel)
    .join("\n");

  return [
    `File count: ${files.length}${truncated ? "+ (truncated)" : ""}`,
    `Top extensions: ${topExts}`,
    `Top-level dirs: ${topDirs}`,
    `Markers: ${[hasTsconfig && "tsconfig", hasPyproject && "python", hasCargo && "cargo", hasGoMod && "go-mod"].filter(Boolean).join(", ") || "none"}`,
    pkg ? `\npackage.json (truncated):\n${pkg}` : "",
    readme ? `\nREADME (truncated):\n${readme}` : "",
    sampleFiles ? `\nSource files (sample):\n${sampleFiles}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Scan + summarize the workspace, writing `.builderforce/architecture.md` and a
 * version-token cache at `.builderforce/scan.json`. Read-through: the expensive walk +
 * LLM summary only runs on a token miss or `force`. Returns the knowledge summary (used
 * as agent system context), or undefined if it could not be produced.
 */
export async function scanCodebase(
  secrets: vscode.SecretStorage,
  root: string,
  model: string | undefined,
  force = false,
): Promise<string | undefined> {
  const bfDir = path.join(root, ".builderforce");
  const cachePath = path.join(bfDir, "scan.json");

  const walkRes = await walk(root);
  const versionToken = computeToken(walkRes.files);

  if (!force) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf-8")) as ScanCache;
      if (cached.versionToken === versionToken && cached.summary) {
        return cached.summary;
      }
    } catch {
      /* no/invalid cache → recompute */
    }
  }

  const digest = await buildDigest(root, walkRes);
  const summary = await complete(
    secrets,
    [
      {
        role: "system",
        content:
          "You summarize a codebase for an AI coding agent. Output concise Markdown (<= 300 words): the project's purpose, primary languages/frameworks, architecture and key directories, build/test commands if evident, and notable conventions. No preamble.",
      },
      { role: "user", content: `Summarize this codebase:\n\n${digest}` },
    ],
    model,
  );

  if (!summary.trim()) return undefined;

  await fs.mkdir(bfDir, { recursive: true });
  await fs.writeFile(
    path.join(bfDir, "architecture.md"),
    `# Architecture (auto-generated by BuilderForce)\n\n${summary}\n`,
    "utf-8",
  );
  const cache: ScanCache = {
    versionToken,
    summary,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  return summary;
}
