/**
 * Example 3: Deep Code Analysis
 *
 * This example demonstrates builderForceAgents's codebase understanding, built on the
 * repo map (`@builderforce/repo-map`):
 * - per-file function / class / interface discovery
 * - exported symbols
 * - the file dependency graph
 * - impact analysis for a change
 */

import { RepoGraph, repoMapPort } from "@builderforce/repo-map";
import fs from "node:fs/promises";
import path from "node:path";
import { runCodeAnalysis } from "../../src/builderforce/shared-tools/node-code-tools.js";

async function main() {
  console.log("Deep Code Analysis Example\n");

  // Example 1: The code_analysis tool backend (what the agent calls)
  console.log("1. Code analysis - symbols, exports and dependency counts\n");
  const analysis = await runCodeAnalysis(".", { filePatterns: ["*.ts"] });
  if ("error" in analysis) {
    console.log(`Note: ${String(analysis.error)}`);
    return;
  }
  console.log("Summary:", analysis.summary);
  console.log("Sample exports:", analysis.topLevelExports);

  // Example 2: Build the file graph yourself and ask what a change would reach
  console.log("\n2. Dependency graph and impact radius\n");
  const root = "./src/builderforce";
  const builder = repoMapPort.create();
  for (const name of await fs.readdir(root)) {
    if (!name.endsWith(".ts")) continue;
    builder.addFile(name, await fs.readFile(path.join(root, name), "utf-8"));
  }
  const { graph } = RepoGraph.fromJSON(builder.build());
  console.log(`Total nodes: ${graph.length}`);

  const sample = graph.paths()[0];
  const sampleIndex = sample === undefined ? undefined : graph.indexOf(sample);
  if (sample !== undefined && sampleIndex !== undefined) {
    const impacted = graph.impactRadius(sampleIndex);
    console.log(`\nSample node: ${sample}`);
    console.log(`  Dependencies: ${graph.dependencies(sampleIndex).length}`);
    console.log(`  Dependents: ${graph.dependents(sampleIndex).length}`);
    console.log(`  Impact radius: ${impacted.length} files`);
    console.log(`  (changing this file could affect ${impacted.length - 1} other files)`);
  }
}

main().catch(console.error);
