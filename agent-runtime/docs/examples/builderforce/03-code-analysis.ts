/**
 * Example 3: Deep Code Analysis
 *
 * This example demonstrates builderForceAgents's deep codebase understanding:
 * - AST parsing
 * - Semantic code maps
 * - Dependency graph analysis
 * - Cross-file reference tracking
 */

import { parseTypeScriptFile, extractImportsAndExports } from "../../src/builderforce/ast-parser.js";
import {
  buildCodeMap,
  buildDependencyGraph,
  calculateImpactRadius,
} from "../../src/builderforce/code-map.js";

async function main() {
  console.log("🤖 Deep Code Analysis Example\n");

  // Example 1: Parse a single file
  console.log("1. AST Parsing - Extracting semantic information\n");

  const exampleFile = "./src/builderforce/agent-roles.ts";
  console.log(`Parsing: ${exampleFile}`);

  try {
    const fileInfo = await parseTypeScriptFile(exampleFile);

    console.log(`\n✓ Discovered:`);
    console.log(`  - Functions: ${fileInfo.functions.length}`);
    console.log(`  - Classes: ${fileInfo.classes.length}`);
    console.log(`  - Interfaces: ${fileInfo.interfaces.length}`);
    console.log(`  - Types: ${fileInfo.types.length}`);

    if (fileInfo.functions.length > 0) {
      console.log(`\n  Sample function: ${fileInfo.functions[0].name}`);
      console.log(`    Line: ${fileInfo.functions[0].line}`);
      console.log(`    Params: ${fileInfo.functions[0].params.join(", ")}`);
      console.log(`    Exported: ${fileInfo.functions[0].exported}`);
    }

    // Example 2: Extract imports and exports
    console.log("\n2. Cross-file Reference Tracking\n");
    const { imports, exports } = await extractImportsAndExports(exampleFile);

    console.log(`✓ Imports: ${imports.length}`);
    if (imports.length > 0) {
      console.log(`  Sample: from "${imports[0].source}"`);
      console.log(`    Imports: ${imports[0].imports.slice(0, 3).join(", ")}`);
    }

    console.log(`\n✓ Exports: ${exports.length}`);
    if (exports.length > 0) {
      console.log(`  Sample exports:`);
      exports.slice(0, 3).forEach((exp) => {
        console.log(`    - ${exp.name} (${exp.kind})`);
      });
    }
  } catch (error) {
    console.log(`Note: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Example 3: Build code map for entire project
  console.log("\n3. Semantic Code Map Generation\n");
  console.log("Building code map for src/builderforce/...");

  try {
    const codeMap = await buildCodeMap("./src/builderforce", ["*.ts"]);

    console.log(`\n✓ Code Map Statistics:`);
    console.log(`  - Total files: ${codeMap.files.size}`);
    console.log(`  - Total exports: ${codeMap.exports.size}`);
    console.log(`  - Dependency relationships: ${codeMap.dependencies.size}`);

    // Example 4: Build dependency graph
    console.log("\n4. Dependency Graph Analysis\n");
    const graph = buildDependencyGraph(codeMap);

    console.log(`✓ Dependency Graph:`);
    console.log(`  - Total nodes: ${graph.size}`);

    // Find a file to analyze
    const sampleFile = Array.from(graph.keys())[0];
    if (sampleFile) {
      const node = graph.get(sampleFile);
      console.log(`\n  Sample node: ${sampleFile.split("/").pop()}`);
      console.log(`    Dependencies: ${node?.dependencies.length || 0}`);
      console.log(`    Dependents: ${node?.dependents.length || 0}`);

      // Calculate impact radius
      const impactRadius = calculateImpactRadius(sampleFile, graph);
      console.log(`    Impact radius: ${impactRadius.size} files`);
      console.log(`    (changing this file could affect ${impactRadius.size - 1} other files)`);
    }
  } catch (error) {
    console.log(`Note: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("\n✓ Deep analysis capabilities:");
  console.log("  - AST-level code understanding");
  console.log("  - Function/class/interface discovery");
  console.log("  - Import/export relationship mapping");
  console.log("  - Dependency graph construction");
  console.log("  - Impact analysis for changes");
  console.log("  - Cross-file reference tracking");
}

main().catch(console.error);
