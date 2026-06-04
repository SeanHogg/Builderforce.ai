/**
 * Tool for analyzing code structure and semantics
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { buildCodeMap, buildDependencyGraph } from "../code-map.js";
import { loadProjectContext } from "../project-context.js";

const CodeAnalysisSchema = Type.Object({
  projectRoot: Type.String({
    description: "Root directory of the project to analyze",
  }),
  filePatterns: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "File patterns to analyze (e.g., ['**/*.ts', '**/*.js']). Defaults to common patterns.",
    }),
  ),
  includeTests: Type.Optional(
    Type.Boolean({
      description: "Whether to include test files in the analysis. Defaults to false.",
    }),
  ),
});

type CodeAnalysisParams = {
  projectRoot: string;
  filePatterns?: string[];
  includeTests?: boolean;
};

export const codeAnalysisTool: AgentTool<typeof CodeAnalysisSchema, string> = {
  name: "code_analysis",
  label: "Code Analysis",
  description:
    "Analyze code structure, dependencies, and semantic relationships in a project. Returns AST information, dependency graphs, and code maps.",
  parameters: CodeAnalysisSchema,
  async execute(_toolCallId: string, params: CodeAnalysisParams) {
    const { projectRoot, filePatterns, includeTests: _includeTests } = params;

    try {
      // Load project context if available
      const context = await loadProjectContext(projectRoot);

      // Determine file patterns
      const patterns =
        filePatterns ||
        (context?.languages.includes("typescript") ? ["**/*.ts", "**/*.tsx"] : ["**/*.js"]);

      // Build code map
      const codeMap = await buildCodeMap(projectRoot, patterns);
      const dependencyGraph = buildDependencyGraph(codeMap);

      // Prepare output
      const fileCount = codeMap.files.size;
      const functionCount = Array.from(codeMap.files.values()).reduce(
        (sum, file) => sum + file.functions.length,
        0,
      );
      const classCount = Array.from(codeMap.files.values()).reduce(
        (sum, file) => sum + file.classes.length,
        0,
      );
      const interfaceCount = Array.from(codeMap.files.values()).reduce(
        (sum, file) => sum + file.interfaces.length,
        0,
      );

      const summary = {
        fileCount,
        functionCount,
        classCount,
        interfaceCount,
        dependencyCount: codeMap.dependencies.size,
        exportCount: codeMap.exports.size,
      };

      // Return structured analysis
      return jsonResult({
        summary,
        files: Array.from(codeMap.files.entries()).map(([path, info]) => ({
          path,
          language: info.language,
          functions: info.functions.length,
          classes: info.classes.length,
          interfaces: info.interfaces.length,
        })),
        topLevelExports: Array.from(codeMap.exports.entries())
          .slice(0, 50)
          .map(([_key, exp]) => ({
            name: exp.name,
            kind: exp.kind,
            file: exp.file,
          })),
        dependencyGraph: Array.from(dependencyGraph.entries())
          .slice(0, 50)
          .map(([file, node]) => ({
            file,
            dependencies: node.dependencies.length,
            dependents: node.dependents.length,
          })),
      }) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to analyze code: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};
