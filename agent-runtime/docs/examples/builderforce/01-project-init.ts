/**
 * Example 1: Initialize a builderForceAgents project
 *
 * This example demonstrates how to initialize a new project with builderForceAgents's
 * persistent context engine, creating the .builderForceAgents directory structure.
 */

import {
  initializeBuilderForceAgentsProject,
  isBuilderForceAgentsProject,
  loadProjectContext,
  loadProjectRules,
} from "../../src/builderforce/project-context.js";

async function main() {
  const projectRoot = process.cwd() + "/test-project";

  console.log("🤖 BuilderForce Agents Project Initialization Example\n");

  // Check if already initialized
  const isInitialized = await isBuilderForceAgentsProject(projectRoot);
  if (isInitialized) {
    console.log("✓ Project already initialized");
    return;
  }

  // Initialize project with context
  console.log("Initializing builderForceAgents project...");
  await initializeBuilderForceAgentsProject(projectRoot, {
    projectName: "test-project",
    description: "A test project demonstrating builderForceAgents capabilities",
    languages: ["typescript", "javascript"],
    frameworks: ["express", "react"],
    architecture: {
      style: "layered",
      layers: ["presentation", "business", "data"],
      patterns: ["mvc", "repository"],
    },
    buildSystem: "npm",
    testFramework: "vitest",
    lintingTools: ["eslint", "prettier"],
  });

  console.log("✓ Project initialized!\n");

  // Load and display context
  const context = await loadProjectContext(projectRoot);
  console.log("Project Context:");
  console.log(JSON.stringify(context, null, 2));

  // Load and display rules
  const rules = await loadProjectRules(projectRoot);
  console.log("\nProject Rules:");
  console.log(JSON.stringify(rules, null, 2));

  console.log("\n✓ .builderForceAgents directory created with:");
  console.log("  - context.yaml (project metadata)");
  console.log("  - architecture.md (design documentation)");
  console.log("  - rules.yaml (coding standards)");
  console.log("  - governance.md (project governance rules)");
  console.log("  - agents/ (custom agent roles)");
  console.log("  - skills/ (project-specific skills)");
  console.log("  - memory/ (knowledge base)");
}

main().catch(console.error);
