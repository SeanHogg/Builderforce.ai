import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { glob } from "glob";
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
  /** All file paths relative to root, matching include glob */
  allFiles: string[];
  /** Full-text concatenation of small files (used for signature search) */
  textByFile: Map<string, string>;
}

// ───────────── Scanning ─────────────

const DEFAULT_INCLUDE_GLOBS = [
  "**/*.{ts,tsx,js,jsx,mjs,json,py,java,go,cs,rb,rs,php,swift,kt}",
];

const ALWAYS_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/coverage/**",
  "**/.builderforce/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/__pycache__/**",
];

function isPathLikeSignature(sig: string): boolean {
  // If the signature looks like a path (contains / or *.ext), treat it as a file-pattern check
  if (sig.includes("/") || sig.includes("\\")) return true;
  if (/^\*+\/?/.test(sig)) return true;
  if (/\.[a-z]{1,5}(\s|$)/i.test(sig) && !sig.includes(" ")) return true;
  return false;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildExcludeList(extra: string[]): string[] {
  const set = new Set([...ALWAYS_EXCLUDE, ...extra]);
  return [...set];
}

/**
 * Single-pass file collection. Reads up to `maxFileBytesToIndex` bytes per file so that
 * 100 planned items can be checked in one pass (AC4: perf).
 */
export async function collectFileIndex(
  rootPath: string,
  excludePatterns: string[],
  maxFileBytesToIndex = 512_000,
): Promise<FileIndex> {
  const ignore = buildExcludeList(excludePatterns);

  const allFiles = await glob(DEFAULT_INCLUDE_GLOBS, {
    cwd: rootPath,
    absolute: false,
    ignore,
    nodir: true,
    maxDepth: 20,
  });

  const textByFile = new Map<string, string>();

  for (const rel of allFiles) {
    const abs = path.join(rootPath, rel);
    try {
      const stat = statSync(abs);
      if (stat.size > maxFileBytesToIndex) continue;
      const content = readFileSync(abs, "utf-8");
      textByFile.set(rel, content);
    } catch {
      // Skip unreadable / binary files
    }
  }

  return { allFiles, textByFile };
}

/**
 * Checks if a signature exists in the codebase.
 * - For path-like signatures, checks glob existence
 * - For code signatures, performs literal substring or regex search across the indexed files
 *
 * Returns the matched file path or null if not found.
 */
export async function checkSignatureExists(
  signature: string,
  rootPath: string,
  index: FileIndex,
  excludePatterns: string[],
): Promise<string | null> {
  const trimmed = signature.trim();
  if (!trimmed) return null;

  // 1) If signature looks like a file path / glob, try glob match first
  if (isPathLikeSignature(trimmed)) {
    try {
      const ignore = buildExcludeList(excludePatterns);
      const matched = await glob(trimmed, {
        cwd: rootPath,
        absolute: false,
        ignore,
        nodir: true,
      });
      if (matched.length > 0) return matched[0];
    } catch {
      // Invalid glob — fall through to text search
    }

    // Also try if it's a relative file that literally exists
    const maybeFile = path.join(rootPath, trimmed);
    if (existsSync(maybeFile)) return trimmed;
  }

  // 2) Text search: literal substring first (fast, no shell, no regex injection)
  for (const [relPath, content] of index.textByFile) {
    if (content.includes(trimmed)) return relPath;
  }

  // 3) Fallback: try as regex if the signature contains regex-ish characters
  //    Parse and run in JS (not shell), with safety guard
  if (/[.*+?^${}()|[\]\\]/.test(trimmed)) {
    try {
      const re = new RegExp(trimmed);
      for (const [relPath, content] of index.textByFile) {
        // Only search first 50k for regex to keep it bounded
        if (re.test(content.slice(0, 100_000))) return relPath;
      }
    } catch {
      // Invalid regex — not found
    }
  }

  return null;
}

/**
 * Core gap-identification logic (FR3). Pure function for testability.
 */
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
    const match = await checkSignatureExists(
      item.signature,
      rootPath,
      fileIndex,
      excludePatterns,
    );
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
      const rootPath: string = typeof params.rootPath === "string" && params.rootPath.trim()
        ? params.rootPath
        : process.cwd();
      const outputFormat: OutputFormat = ["markdown", "json", "csv"].includes(params.outputFormat)
        ? params.outputFormat
        : "markdown";
      const excludePatterns: string[] = Array.isArray(params.excludePatterns)
        ? params.excludePatterns
        : ["**/node_modules/**", "**/dist/**", "**/.git/**"];

      // Single-pass file indexing for performance (AC4: 100 items in < 5min)
      const index = await collectFileIndex(rootPath, excludePatterns);

      // FR3: Gap identification
      const { gaps, found } = await identifyGaps(items, rootPath, excludePatterns, index);

      // FR4/FR5: Build structured report
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
