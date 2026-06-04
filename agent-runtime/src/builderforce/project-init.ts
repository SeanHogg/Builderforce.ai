import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { resolveBuilderForceAgentsDir } from "./project-dir.js";
import type { ProjectContext, ProjectRules } from "./types.js";

/**
 * Initialize a new builderForceAgents project directory
 */
export async function initializeBuilderForceAgentsProject(
  projectRoot: string,
  context?: Partial<ProjectContext>,
): Promise<void> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);

  // Create directory structure
  await fs.mkdir(dir.root, { recursive: true });
  await fs.mkdir(dir.skillsDir, { recursive: true });
  await fs.mkdir(dir.memoryDir, { recursive: true });
  await fs.mkdir(dir.sessionsDir, { recursive: true });
  await fs.mkdir(dir.personasDir, { recursive: true });

  // Create default context.yaml
  const defaultContext: ProjectContext = {
    version: 1,
    projectName: context?.projectName || path.basename(projectRoot),
    description: context?.description || "A builderForceAgents-enabled project",
    rootPath: projectRoot,
    languages: context?.languages || [],
    frameworks: context?.frameworks || [],
    architecture: context?.architecture || {
      style: "unknown",
      layers: [],
      patterns: [],
    },
    buildSystem: context?.buildSystem,
    testFramework: context?.testFramework,
    lintingTools: context?.lintingTools || [],
    dependencies: context?.dependencies || {
      production: {},
      development: {},
    },
    customRules: context?.customRules || [],
    metadata: context?.metadata || {},
    ...(context?.llm ? { llm: context.llm } : {}),
    ...(context?.builderforce ? { builderforce: context.builderforce } : {}),
  };

  await fs.writeFile(dir.contextPath, stringifyYaml(defaultContext), "utf-8");

  // Create default architecture.md
  const defaultArchitecture = `# Architecture

## Overview

This document describes the architectural design and patterns used in this project.

## Components

### Core Modules

(To be documented)

## Design Patterns

(To be documented)

## Data Flow

(To be documented)

## Dependencies

(To be documented)
`;
  await fs.writeFile(dir.architecturePath, defaultArchitecture, "utf-8");

  // Create placeholder governance.md for project-level policies
  const defaultGovernance = `# Governance Rules

Define project governance in Markdown. These rules will be read by agents and
used to guide decision-making.
`;
  await fs.writeFile(dir.governancePath, defaultGovernance, "utf-8");

  // Create default rules.yaml
  const defaultRules: ProjectRules = {
    version: 1,
    codeStyle: {
      indentation: "spaces",
      indentSize: 2,
      lineLength: 100,
      namingConventions: {},
    },
    testing: {
      required: true,
      coverage: 80,
      frameworks: [],
    },
    documentation: {
      required: true,
      format: "markdown",
      location: "docs/",
    },
    git: {
      branchNaming: "feature/*, fix/*, docs/*",
      commitFormat: "conventional",
      requireReview: true,
    },
    constraints: [],
    customRules: [],
  };

  await fs.writeFile(dir.rulesPath, stringifyYaml(defaultRules), "utf-8");

  // Create README
  const readme = `# .builderForceAgents Directory

This directory contains project-specific context and configuration for builderForceAgents.

## Structure

- \`context.yaml\` - Project metadata, languages, frameworks, dependencies
- \`architecture.md\` - Architectural documentation and design patterns
- \`rules.yaml\` - Coding standards, testing requirements, git conventions
- \`personas/\` - Custom agent roles/personas (YAML)
- \`skills/\` - Project-specific skills
- \`memory/\` - Project knowledge base and semantic indices
- \`sessions/\` - Session handoff documents (resume any session instantly)

## Usage

builderForceAgents agents automatically load context from this directory when working on the project.
`;

  await fs.writeFile(path.join(dir.root, "README.md"), readme, "utf-8");
}
