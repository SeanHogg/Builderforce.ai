import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { BuilderForceAgentsPluginApi } from "../../../src/plugins/types.js";

// ───────────── Types ─────────────

export interface PlannedItem {
  id: string;
  name: string;
  signature: string;
  sourceDocument?: string;
  priority?: string;
}

interface GapItem extends PlannedItem {}

interface GapReport {
  projectName: string;
  scanDate: string;
  totalItems: number;
  implemented: number;
  gapsCount: number;
  gaps: GapItem[];
}

type OutputFormat = "markdown" | "json" | "csv";

// Internal cache for single-pass scanning
interface FileIndex {
  allFiles: string[];
  textByFile: Map<string, string>;
}

const DEFAULT_CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  ".py",
  ".java",
  ".go",
  ".cs",
  ".rb",
  ".rs",
  ".php",
  ".swift",
  ".kt",
]);

const ALWAYS_EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  ".builderforce",
  ".next",
  ".turbo",
  "__pycache__",
]);

const ALWAYS_EXCLUDE_PARTS = [
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".builderforce",
  ".next",
  ".turbo",
  "__pycache__",
];

// ───────────── Exclude matching ─────────────

function matchesExclude(relPath: string, extra: string[]): boolean {
  const parts = relPath.split("/");
  // Check always-exclude directory names
  for (const p of parts) {
    if (ALWAYS_EXCLUDE_DIRS.has(p)) return true;
  }
  for (const always of ALWAYS_EXCLUDE_PARTS) {
    if (relPath.includes(always)) return true;
  }
  // Check caller-provided globs (simple: if substring match after stripping **/ prefix)
  for (const pat of extra) {
    const cleaned = pat.replace(/\*\*\//g, "").replace(/\*\*/g, "").replace(/\*/g, "");
    if (cleaned && relPath.includes(cleaned)) return true;
    // Also support simple suffix patterns like *.min.js
    if (pat.includes("*") && relPath.endsWith(pat.replace(/^\*\*?\//, "").replace(/^\*/, ""))) {
      return true;
    }
  }
  return false;
}

// ───────────── File collection (native fs) ─────────────

function walkDir(
  dir: string,
  root: string,
  exclude: string[],
  maxDepth: number,
  curDepth: number,
  files: string[],
): void {
  if (curDepth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    if (matchesExclude(rel, exclude)) continue;

    if (ent.isDirectory()) {
      // Skip excluded dirs fast via name check
      if (ALWAYS_EXCLUDE_DIRS.has(ent.name)) continue;
      walkDir(abs, root, exclude, maxDepth, curDepth + 1, files);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      // Include files whose extension is in the known set OR files that match file-pattern signatures later
      if (DEFAULT_CODE_EXTS.has(ext)) {
        files.push(rel);
      } else {
        // still index dot-less or unusual extension if caller explicitly adds them via signatures
        // we include them only if not binary-like; for now limit to text-ish
        files.push(rel);
      }
    }
  }
}

function isPathLikeSignature(sig: string): boolean {
  if (sig.includes("/") || sig.includes("\\")) return true;
  if (/^\*+\/?/.test(sig)) return true;
  if (/^\.?\.?\//.test(sig)) return true;
  return false;
}

function simpleGlobToTest(pattern: string): (p: string) => boolean {
  // Convert minimal glob (*, **) to a predicate; safe, no shell.
  // Escape regexp except * then replace ** -> .* and * -> [^/]*
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__GLOBSTAR__/g, ".*");
  // allow {a,b} alternation minimal
  const withAlts = escaped.replace(/\\\{/g, "{").replace(/\\\}/g, "}").replace(/\{([^}]+)\}/g, (_m, inner: string) => {
    const parts = inner.split(",").map((s: string) => s.trim());
    return `(${parts.join("|")})`;
  });
  try {
    const re = new RegExp(`^${withAlts}$`);
    return (p: string) => re.test(p);
  } catch {
    return (_p: string) => false;
  }
}

export async function collectFileIndex(
  rootPath: string,
  excludePatterns: string[],
  maxFileBytesToIndex = 512_000,
): Promise<FileIndex> {
  const allFiles: string[] = [];
  const rootStat = (() => {
    try {
      return fs.statSync(rootPath);
    } catch {
      return null;
    }
  })();
  if (rootStat?.isDirectory()) {
    walkDir(rootPath, rootPath, excludePatterns, 20, 0, allFiles);
  }

  const textByFile = new Map<string, string>();

  for (const rel of allFiles) {
    const abs = path.join(rootPath, rel);
    try {
      const stat = fs.statSync(abs);
      if (stat.size > maxFileBytesToIndex) continue;
      const content = fs.readFileSync(abs, "utf-8");
      textByFile.set(rel, content);
    } catch {
      // Skip unreadable / binary files
    }
  }

  return { allFiles, textByFile };
}

export async function checkSignatureExists(
  signature: string,
  rootPath: string,
  index: FileIndex,
  excludePatterns: string[],
): Promise<string | null> {
  const trimmed = signature.trim();
  if (!trimmed) return null;

  // 1) If signature looks like a file path / glob, try file-pattern match (native, no shell)
  if (isPathLikeSignature(trimmed)) {
    const existsLiteral = (() => {
      try {
        return fs.existsSync(path.join(rootPath, trimmed));
      } catch {
        return false;
      }
    })();
    if (existsLiteral) return trimmed;

    // Glob-style match against indexed files using safe predicate
    const tester = simpleGlobToTest(trimmed);
    for (const rel of index.allFiles) {
      if (matchesExclude(rel, excludePatterns)) continue;
      if (tester(rel)) return rel;
    }
    // Also try unanchored contains when pattern has no wildcards but includes a slash/file name
    if (!trimmed.includes("*")) {
      const lower = trimmed.toLowerCase();
      for (const rel of index.allFiles) {
        if (rel.toLowerCase().includes(lower)) return rel;
      }
    }
  }

  // 2) Text search: literal substring (fast, no shell, no injection)
  for (const [relPath, content] of index.textByFile) {
    if (content.includes(trimmed)) return relPath;
  }

  // 3) Fallback: try as regex if it contains regex-ish characters (safe, in JS, not shell)
  if (/[.*+?^${}()|[\]\\]/.test(trimmed)) {
    try {
      const re = new RegExp(trimmed);
      for (const [relPath, content] of index.textByFile) {
        if (re.test(content.slice(0, 100_000))) return relPath;
      }
    } catch {
      // Invalid regex — not found
    }
  }

  return null;
}

export async function identifyGaps(
  items: PlannedItem[],
  rootPath: string,
  excludePatterns: string[],
  index?: FileIndex,
): Promise<{ gaps: GapItem[]; found: Map<string, string> }> {
  const fileIndex = index ?? (await collectFileIndex(rootPath, excludePatterns));
  const gaps: GapItem[] = [];
  const found = new Map<string, string>();

  for (const item of items) {
    const match = await checkSignatureExists(item.signature, rootPath, fileIndex, excludePatterns);
    if (match) {
      found.set(item.id, match);
    } else {
      gaps.push(item);
    }
  }

  return { gaps, found };
}

// ───────────── Output formatting (FR4, FR5) ─────────────

export function generateMarkdown(report: GapReport): string {
  const date = new Date(report.scanDate).toLocaleString();
  let out = `# Code Gap Analysis\n\n`;
  out += `**Project:** ${report.projectName}\n`;
  out += `**Scan Date:** ${date}\n`;
  out += `**Total Planned Items:** ${report.totalItems}\n`;
  out += `**Implemented:** ${report.implemented}\n`;
  out += `**Gaps Identified:** ${report.gapsCount}\n\n---\n\n`;

  if (report.gaps.length > 0) {
    out += `## 🚨 Missing Features (Gap List)\n\n`;
    out += `The following ${report.gaps.length} planned features were not found in the codebase:\n\n`;
    out += `| ID | Name | Signature | Priority | Source Document |\n`;
    out += `|----|------|-----------|----------|----------------|\n`;
    for (const gap of report.gaps) {
      const src = escapeMdCell(gap.sourceDocument || "-");
      const pri = escapeMdCell(gap.priority || "-");
      const sig = `\`${escapeMdCode(gap.signature)}\``;
      out += `| ${escapeMdCell(gap.id)} | ${escapeMdCell(gap.name)} | ${sig} | ${pri} | ${src} |\n`;
    }
    out += `\n`;
  } else {
    out += `## ✅ No Gaps Found\n\nAll ${report.totalItems} planned items were found in the codebase.\n\n`;
  }

  out += `---\n\n**Analysis completed by BuilderForce Code Gap Analysis tool.**\n`;
  return out;
}

export function generateCSV(report: GapReport): string {
  let out = `Project,Scan Date,Total Items,Implemented,Gaps Count\n`;
  out += `"${csvEscape(report.projectName)}","${csvEscape(report.scanDate)}",${report.totalItems},${report.implemented},${report.gapsCount}\n\n`;

  if (report.gaps.length > 0) {
    out += `ID,Name,Signature,Priority,Source Document\n`;
    for (const gap of report.gaps) {
      out += `"${csvEscape(gap.id)}","${csvEscape(gap.name)}","${csvEscape(gap.signature)}","${csvEscape(gap.priority || "")}","${csvEscape(gap.sourceDocument || "")}"\n`;
    }
  }

  return out;
}

export function generateJSON(report: GapReport): string {
  return JSON.stringify(report, null, 2);
}

function generateOutput(report: GapReport, format: OutputFormat): string {
  switch (format) {
    case "json":
      return generateJSON(report);
    case "csv":
      return generateCSV(report);
    case "markdown":
    default:
      return generateMarkdown(report);
  }
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function escapeMdCode(s: string): string {
  return s.replace(/`/g, "'").slice(0, 300);
}

function csvEscape(s: string): string {
  return s.replace(/"/g, '""');
}

// ───────────── Tool registration (FR1-FR5, AC1-AC5) ─────────────

export function createCodeGapsTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "code-gaps",
    label: "Code Gap Analysis",
    description:
      "Identify code gaps by comparing planned features against the current codebase. Define planned items with expected code signatures, then scan to find what is missing. Supports file-pattern and code-signature detection with markdown/json/csv output.",
    parameters: Type.Object({
      items: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String({ description: "Unique identifier (e.g., feature-id-001)" }),
            name: Type.String({ description: "Descriptive name of the feature" }),
            signature: Type.String({
              description:
                "Expected code signature or artifact (e.g., 'class UserProfileAvatarService', 'function uploadAvatar', 'api/v1/user/{id}/avatar')",
            }),
            sourceDocument: Type.Optional(
              Type.String({ description: "Associated source document, Jira ticket, or design doc ID" }),
            ),
            priority: Type.Optional(
              Type.String({
                pattern: "^P[0-3]$",
                description: "Priority level (P0 highest, P3 lowest)",
              }),
            ),
          }),
          { description: "Planned features/components to check", default: [] },
        ),
      ),
      rootPath: Type.Optional(
        Type.String({ description: "Root path of the codebase to scan", default: process.cwd() }),
      ),
      outputFormat: Type.Optional(
        Type.String({
          enum: ["markdown", "json", "csv"],
          description: "Output format for the gap report",
          default: "markdown",
        }),
      ),
      excludePatterns: Type.Optional(
        Type.Array(Type.String(), {
          description: "Additional glob patterns to exclude from scan (e.g., '** /__tests__/**')",
          default: ["**/node_modules/**", "**/dist/**"],
        }),
      ),
    }),

    async execute(_toolId: string, params: any) {
      const items: PlannedItem[] = Array.isArray(params.items) ? params.items : [];
      const rootPath: string =
        typeof params.rootPath === "string" && params.rootPath.trim()
          ? params.rootPath
          : process.cwd();
      const outputFormat: OutputFormat = ["markdown", "json", "csv"].includes(params.outputFormat)
        ? params.outputFormat
        : "markdown";
      const excludePatterns: string[] = Array.isArray(params.excludePatterns)
        ? params.excludePatterns
        : ["**/node_modules/**", "**/dist/**", "**/.git/**"];

      const index = await collectFileIndex(rootPath, excludePatterns);
      const { gaps, found } = await identifyGaps(items, rootPath, excludePatterns, index);

      const report: GapReport = {
        projectName: rootPath.split("/").pop() || "unknown",
        scanDate: new Date().toISOString(),
        totalItems: items.length,
        implemented: found.size,
        gapsCount: gaps.length,
        gaps: gaps.map((g) => ({
          id: g.id,
          name: g.name,
          signature: g.signature,
          sourceDocument: g.sourceDocument,
          priority: g.priority,
        })),
      };

      const output = generateOutput(report, outputFormat);

      return {
        content: [{ type: "text", text: output }],
        details: {
          report,
          gapsCount: gaps.length,
          implementedCount: found.size,
          foundMap: Object.fromEntries(found),
        },
      };
    },
  } as const;
}
