import { execSync } from "node:child_process";
import { glob } from "glob";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";

// Types
interface PlannedItem {
  id: string;
  name: string;
  signature: string;
  sourceDocument?: string;
  priority?: string;
}

interface FoundArtifact {
  filePath: string;
  signature?: string;
  matches: Array<{ line: number; content: string; snippet: string }>;
}

interface GapReport {
  projectName: string;
  scanDate: string;
  totalItems: number;
  expectedItems: number;
  foundItems: number;
  gaps: Array<{
    id: string;
    name: string;
    signature: string;
    sourceDocument?: string;
    priority?: string;
  }>;
  summary: {
    totalItems: number;
    implemented: number;
    notStarted?: number;
    blocked?: number;
  };
}

type OutputFormat = "markdown" | "json" | "csv";

/**
 * Determines if a specific file pattern exists in the codebase
 */
async function checkFileExists(pattern: string, rootPath: string, excludePatterns: string[]): Promise<boolean> {
  try {
    const files = await glob(pattern, {
      cwd: rootPath,
      absolute: false,
      ignore: [...excludePatterns, "**/node_modules/**"],
      nodir: true,
    });

    return files.length > 0;
  } catch {
    return false;
  }
}

/**
 * Attempts to find occurrences of a signature across the codebase using grep
 */
async function findSignatureOccurrences(
  signature: string,
  rootPath: string,
  excludePatterns: string[]
): Promise<FoundArtifact | null> {
  try {
    // Build grep command (fallback to find if grep not available)
    let command = "";
    if (process.platform === "win32") {
      // Windows fallback - use simple file reading with includes
      return null;
    }

    const regex = new RegExp(
      // Escape special regex characters in signature
      signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g"
    );

    // Create a temporary file with the search term
    const searchFile = `${rootPath}/.builderforce/_search-grep`;
    await Deno.writeTextFile(searchFile, signature);

    try {
      // Use grep across all source files
      const output = execSync(
        `grep -R --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.json" --include="*.py" --include="*.java" --include="*.go" -l -E "${signature}" ${rootPath} 2>/dev/null || true`,
        {
          cwd: "/",
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        }
      ).toString();

      const matches = output
        .split("\n")
        .filter((line) => line.trim())
        .map((filePath) => `${rootPath}/${filePath}`);

      if (matches.length > 0) {
        return {
          filePath: matches[0],
          matches: [],
        };
      }
    } catch {
      // Continue if grep fails
    } finally {
      try {
        Deno.removeSync(searchFile);
      } catch {
        // Ignore
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Scans the codebase and verifies planned items against actual code
 */
export function createCodeGapsTool(api: any): AnyAgentTool {
  return {
    name: "code-gaps",
    label: "Code Gap Analysis",
    description:
      "Identify code gaps by comparing planned features against the current codebase. Define planned items with expected code signatures, then scan to find what is missing.",
    parameters: Type.Object({
      items: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String({ description: "Unique identifier (e.g., feature-id-001)" }),
            name: Type.String({ description: "Descriptive name of the feature" }),
            signature: Type.String({ description: "Expected code signature or artifact (e.g., code path, function name)" }),
            sourceDocument: Type.Optional(Type.String({ description: "Associated source document Jira ticket, design doc" })),
            priority: Type.Optional(
              Type.String({
                pattern: "^[P0-P3]$",
                description: "Priority level",
              })
            ),
          }),
          { default: [] }
        )
      ),
      rootPath: Type.Optional(
        Type.String({ description: "Root path of the codebase to scan", default: process.cwd() })
      ),
      outputFormat: Type.Optional(
        Type.String({ enum: ["markdown", "json", "csv"], description: "Output format", default: "markdown" })
      ),
      excludePatterns: Type.Optional(
        Type.Array(Type.String(), { description: "Exclude patterns", default: ["node_modules", "dist"] })
      ),
    }),

    async execute(toolId: string, params: any) {
      const items: PlannedItem[] = params.items ?? [];
      const rootPath = params.rootPath ?? process.cwd();
      const outputFormat = params.outputFormat ?? "markdown";
      const excludePatterns = params.excludePatterns ?? ["node_modules", "dist", ".git"];

      console.log(`🤖 Code Gap Analysis - Scanning ${rootPath}`);
      console.log(`   Looking for ${items.length} planned items...\n`);

      const gaps: PlannedItem[] = [];

      // Scan each planned item
      for (const item of items) {
        console.log(`   Checking: ${item.name} (${item.id})`);
        console.log(`     Expected signature: ${item.signature}`);
        console.log(`     Priority: ${item.priority ?? "N/A"}`);

        const found = await checkSignature(item.signature, rootPath, excludePatterns);

        if (!found) {
          console.log(`     ❌ NOT FOUND - Grieving gap identified\n`);
          gaps.push(item);
        } else {
          console.log(`     ✓ Found in: ${found}\n`);
        }
      }

      // Build report
      const report: GapReport = {
        projectName: rootPath.split("/").pop() ?? "unknown",
        scanDate: new Date().toISOString(),
        totalItems: items.length,
        expectedItems: items.length,
        foundItems: items.length - gaps.length,
        gaps: gaps,
        summary: {
          totalItems: items.length,
          implemented: items.length - gaps.length,
          notStarted: gaps.length,
        },
      };

      // Generate output
      const output = generateOutput(report, outputFormat);

      return {
        content: [{ type: "text", text: output }],
        details: { report, gapsCount: gaps.length },
      };
    },
  };
}

/**
 * Determines if a signature exists in the codebase
 */
async function checkSignature(signature: string, rootPath: string, excludePatterns: string[]): Promise<string | null> {
  // Check for file existence first
  const filePattern = escapeSignatureForGlob(signature);
  const exists = await checkFileExists(filePattern, rootPath, excludePatterns);

  if (exists) {
    return `file pattern matches: ${filePattern}`;
  }

  // Check for code patterns
  const foundArtifact = await findSignatureOccurrences(signature, rootPath, excludePatterns);
  return foundArtifact?.filePath ?? null;
}

/**
 * Escapes a signature for use in glob patterns
 */
function escapeSignatureForGlob(signature: string): string {
  // Remove or escape special glob characters
  return signature
    .split(/[.*+?^${}()|[\]\\]/)
    .join("\\")
    .replace(/\*/g, "*")
    .replace(/\?/g, "?");
}

/**
 * Generates output in the specified format
 */
function generateOutput(report: GapReport, format: OutputFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "csv":
      return generateCSV(report);
    case "markdown":
    default:
      return generateMarkdown(report);
  }
}

/**
 * Generates Markdown output
 */
function generateMarkdown(report: GapReport): string {
  const date = new Date(report.scanDate).toLocaleString();

  let output = `# Code Gap Analysis\n\n`;
  output += `**Project:** ${report.projectName}\n`;
  output += `**Scan Date:** ${date}\n`;
  output += `**Total Planned Items:** ${report.totalItems}\n`;
  output += `**Implemented:** ${report.foundItems}\n`;
  output += `**Gaps Identified:** ${report.gaps.length}\n\n`;
  output += `---\n\n`;

  if (report.gaps.length > 0) {
    output += `## 🚨 Missing Features (Gap List)\n\n`;
    output += `The following ${report.gaps.length} planned features were not found in the codebase:\n\n`;
    output += `| ID | Name | Signature | Priority | Source Document |\n`;
    output += `|----|------|-----------|----------|-----------------|\n`;

    for (const gap of report.gaps) {
      const sourceDoc = gap.sourceDocument || "-";
      const priority = gap.priority || "-";
      output += `| ${gap.id} | ${gap.name} | \`${gap.signature}\` | ${priority} | ${sourceDoc} |\n`;
    }

    output += `\n`;
  } else {
    output += `## ✅ No Gaps Found\n\n`;
    output += `All ${report.totalItems} planned items were found in the codebase.\n\n`;
  }

  // Detailed report section
  if (report.gaps.length > 0) {
    output += `### Detailed Items by Status\n\n`;
    output += `#### Planned Items (${report.totalItems})\n\n`;
    output += `| ID | Name | Signature | Priority | Source Document | Status |\n`;
    output += `|----|------|-----------|----------|-----------------|--------|\n`;

    for (const item of report.gaps) {
      output += `| ${item.id} | ${item.name} | \`${item.signature}\` | ${item.priority || "N/A"} | ${item.sourceDocument || "-"} | ❌ Gap |\n`;
    }

    output += `\n`;
  }

  output += `---\n`;
  output += `\n`;
  output += `**Analysis completed by BuilderForce Code Gap Analysis tool.**\n`;

  return output;
}

/**
 * Generates CSV output
 */
function generateCSV(report: GapReport): string {
  let output = `Project,Scan Date,Total Items,Expected Items,Found Items,Gaps Count\n`;
  output += `"${report.projectName}","${report.scanDate}",${report.totalItems},${report.expectedItems},${report.foundItems},${report.gaps.length}\n\n`;

  if (report.gaps.length > 0) {
    output += `ID,Name,Signature,Priority,Source Document\n`;

    for (const gap of report.gaps) {
      const sourceDoc = gap.sourceDocument?.replace(/"/g, '""') || "";
      const priority = gap.priority || "";
      output += `"${gap.id}","${gap.name}","${gap.signature}","${priority}","${sourceDoc}"\n`;
    }
  }

  return output;
}