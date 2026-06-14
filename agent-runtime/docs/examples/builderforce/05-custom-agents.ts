/**
 * Example 5: Custom Agent Roles
 *
 * This example demonstrates creating custom agent roles for project-specific workflows.
 * Custom agents are defined in .builderforce/agents/ and can be loaded dynamically.
 */

import { getBuiltInAgentRoles } from "../../src/builderforce/agent-roles.js";
import type { AgentRole } from "../../src/builderforce/types.js";

async function main() {
  console.log("🤖 Custom Agent Roles Example\n");

  // Show built-in agent roles
  console.log("Built-in Agent Roles:");
  const builtInRoles = getBuiltInAgentRoles();
  for (const role of builtInRoles) {
    console.log(`  - ${role.name}: ${role.description}`);
  }

  console.log("\n✓ Creating Custom Agent Roles:\n");

  // Example custom agent: Database Migration Specialist
  const dbMigrationAgent: AgentRole = {
    name: "db-migration-specialist",
    description:
      "Specialized in creating and reviewing database migrations with zero-downtime strategies",
    capabilities: [
      "Create forward and rollback migrations",
      "Ensure backward compatibility",
      "Optimize migration performance",
      "Handle data transformations safely",
      "Validate migration scripts",
      "Plan zero-downtime deployments",
    ],
    tools: ["create", "edit", "view", "bash", "grep"],
    systemPrompt: `You are a Database Migration Specialist. Your role is to create safe, performant database migrations.

Guidelines:
- Always create both up and down migrations
- Ensure backward compatibility during rolling deployments
- Use transactions where appropriate
- Add indexes after data population for better performance
- Validate data integrity after migrations
- Document any manual steps required
- Consider the impact on running services
- Test migrations on production-like datasets`,
    model: "anthropic/claude-sonnet-4-20250514",
    thinking: "high",
    constraints: [
      "Must maintain data integrity",
      "Must be reversible",
      "Must work with zero-downtime deployments",
    ],
  };

  console.log("Example Custom Agent: Database Migration Specialist");
  console.log(JSON.stringify(dbMigrationAgent, null, 2));

  // Example custom agent: API Documentation Generator
  const apiDocsAgent: AgentRole = {
    name: "api-docs-generator",
    description:
      "Generates comprehensive API documentation with examples, schemas, and best practices",
    capabilities: [
      "Extract API endpoints from code",
      "Generate OpenAPI/Swagger specs",
      "Create usage examples",
      "Document request/response schemas",
      "Add authentication details",
      "Include error handling guide",
    ],
    tools: ["view", "create", "grep", "bash"],
    systemPrompt: `You are an API Documentation Generator. Create clear, comprehensive API documentation.

Focus on:
- Complete endpoint descriptions with HTTP methods and paths
- Request/response examples in multiple formats (JSON, curl)
- Authentication and authorization requirements
- Error codes and handling
- Rate limiting and pagination details
- Versioning information
- Best practices and common pitfalls`,
    model: "anthropic/claude-sonnet-4-20250514",
    thinking: "medium",
  };

  console.log("\n\nExample Custom Agent: API Documentation Generator");
  console.log(JSON.stringify(apiDocsAgent, null, 2));

  console.log("\n\n✓ Custom Agent Definition (YAML format for .builderforce/agents/):\n");
  console.log(`# .builderforce/agents/performance-optimizer.yaml
name: performance-optimizer
description: Specializes in performance optimization and profiling
capabilities:
  - Profile application performance
  - Identify bottlenecks
  - Optimize database queries
  - Reduce memory usage
  - Improve response times
  - Add performance tests
tools:
  - view
  - edit
  - bash
  - grep
  - glob
systemPrompt: |
  You are a Performance Optimizer. Your role is to identify and fix performance issues.
  
  Approach:
  - Measure first, optimize second
  - Focus on biggest bottlenecks
  - Profile before and after changes
  - Consider trade-offs (speed vs memory vs complexity)
  - Validate improvements with benchmarks
  - Document optimization rationale
model: anthropic/claude-sonnet-4-20250514
thinking: high
constraints:
  - Must not break existing functionality
  - Must validate performance improvements with metrics
  - Must consider production workload patterns
`);

  console.log("\n✓ Using Custom Agents:");
  console.log("  1. Create YAML file in .builderforce/agents/");
  console.log("  2. Define name, capabilities, tools, and prompt");
  console.log("  3. Agent is automatically loaded by builderForceAgents");
  console.log("  4. Use in workflows alongside built-in agents");

  console.log("\n✓ Community-Extensible:");
  console.log("  - Share agent definitions across projects");
  console.log("  - Build domain-specific agent libraries");
  console.log("  - Customize for team workflows");
  console.log("  - Version control agent definitions");
}

main().catch(console.error);
