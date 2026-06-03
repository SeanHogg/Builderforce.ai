/**
 * Code mapping and dependency graph analysis
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseTypeScriptFile, extractImportsAndExports } from "./ast-parser.js";
import type { CodeMap, DependencyNode, ExportInfo, ImportInfo, FileInfo } from "./types.js";

/**
 * Build a semantic code map for a project
 */
export async function buildCodeMap(projectRoot: string, filePatterns: string[]): Promise<CodeMap> {
  const files = new Map<string, FileInfo>();
  const dependencies = new Map<string, string[]>();
  const exports = new Map<string, ExportInfo>();
  const imports = new Map<string, ImportInfo[]>();

  // Parse all matching files
  for (const pattern of filePatterns) {
    const matchedFiles = await findFiles(projectRoot, pattern);

    for (const file of matchedFiles) {
      try {
        const fileInfo = await parseTypeScriptFile(file);
        files.set(file, fileInfo);

        // Extract imports and exports
        const { imports: fileImports, exports: fileExports } = await extractImportsAndExports(file);

        // Store imports
        const importInfos: ImportInfo[] = fileImports.map((imp) => ({
          source: imp.source,
          imports: imp.imports,
          file,
          line: 0, // Could be extracted from AST if needed
        }));
        imports.set(file, importInfos);

        // Store exports
        for (const exp of fileExports) {
          const exportInfo: ExportInfo = {
            name: exp.name,
            kind: exp.kind as ExportInfo["kind"],
            file,
            line: 0, // Could be extracted from AST if needed
          };
          exports.set(`${file}:${exp.name}`, exportInfo);
        }

        // Build dependency list
        const depPromises = fileImports.map((imp) =>
          resolveImportPath(file, imp.source, projectRoot),
        );
        const resolvedDeps = await Promise.all(depPromises);
        const deps = resolvedDeps.filter((p): p is string => p !== null);
        dependencies.set(file, deps);
      } catch (error) {
        // Skip files that can't be parsed
        console.warn(`Failed to parse ${file}:`, error);
      }
    }
  }

  return { files, dependencies, exports, imports };
}

/**
 * Build a dependency graph from a code map
 */
export function buildDependencyGraph(codeMap: CodeMap): Map<string, DependencyNode> {
  const graph = new Map<string, DependencyNode>();

  // Initialize nodes
  for (const file of codeMap.files.keys()) {
    graph.set(file, {
      file,
      dependencies: [],
      dependents: [],
    });
  }

  // Build dependencies and dependents
  for (const [file, deps] of codeMap.dependencies.entries()) {
    const node = graph.get(file);
    if (node) {
      node.dependencies = deps;

      // Add reverse edges
      for (const dep of deps) {
        const depNode = graph.get(dep);
        if (depNode && !depNode.dependents.includes(file)) {
          depNode.dependents.push(file);
        }
      }
    }
  }

  return graph;
}

/**
 * Find files matching a glob pattern
 */
async function findFiles(rootDir: string, pattern: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip node_modules, .git, dist, etc.
          if (
            !entry.name.startsWith(".") &&
            entry.name !== "node_modules" &&
            entry.name !== "dist" &&
            entry.name !== "build" &&
            entry.name !== "coverage"
          ) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          if (matchesPattern(entry.name, pattern)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walk(rootDir);
  return files;
}

/**
 * Simple glob pattern matching
 */
function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    return regex.test(filename);
  }
  return filename === pattern;
}

/**
 * Resolve an import path to an absolute file path
 */
async function resolveImportPath(
  fromFile: string,
  importPath: string,
  _projectRoot: string,
): Promise<string | null> {
  // Skip node_modules imports
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(fromDir, importPath);

  // Try common extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", ""];
  for (const ext of extensions) {
    const candidate = resolved + ext;
    try {
      await fs.stat(candidate);
      return candidate;
    } catch {
      // Try next extension
    }
  }

  // Try index files
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = path.join(resolved, `index${ext}`);
    try {
      await fs.stat(candidate);
      return candidate;
    } catch {
      // Try next extension
    }
  }

  return null;
}

/**
 * Find all files that depend on a given file
 */
export function findDependents(file: string, graph: Map<string, DependencyNode>): string[] {
  const node = graph.get(file);
  return node ? node.dependents : [];
}

/**
 * Find all files that a given file depends on
 */
export function findDependencies(file: string, graph: Map<string, DependencyNode>): string[] {
  const node = graph.get(file);
  return node ? node.dependencies : [];
}

/**
 * Find the impact radius of changing a file
 */
export function calculateImpactRadius(
  file: string,
  graph: Map<string, DependencyNode>,
): Set<string> {
  const impacted = new Set<string>();
  const queue = [file];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (impacted.has(current)) {
      continue;
    }

    impacted.add(current);
    const dependents = findDependents(current, graph);
    queue.push(...dependents);
  }

  return impacted;
}
