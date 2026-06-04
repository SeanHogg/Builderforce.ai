---
name: builderforce
description: "Multi-agent developer system for code creation, review, testing, debugging, and architecture. Use for complex development workflows requiring orchestration of specialized agents. Provides deep codebase understanding through AST parsing, dependency graphs, and git history analysis. Now includes memory-aware orchestration and cross-agentNode delegation."
author: builderForceAgents
author-url: https://builderforce.ai
metadata: { "builderforce": { "emoji": "🛠️" } }
---

# builderForceAgents: Multi-Agent Developer System

builderForceAgents is a developer-first multi-agent system for comprehensive software development workflows.

## Quick Start

### Initialize a Project

```bash
# Initialize builderforce in current project
builderforce init

# Check project status
builderforce project status
```

### Use builderForceAgents Tools

Once initialized, use builderforce tools in agent conversations:

```
# Analyze code structure
code_analysis projectRoot:/path/to/project

# Query project knowledge
project_knowledge projectRoot:/path/to/project query:all

# Analyze git history
git_history projectRoot:/path/to/project limit:50

# Orchestrate a feature workflow
orchestrate workflow:feature description:"Add user authentication"

# Check workflow status
workflow_status workflowId:abc-123

# Memory-aware operations
index-memory
suggest-memory
share-memory
delegate-to <agentNodeId>
```

## Core Capabilities

### 1. Deep Code Understanding

- **AST Parsing**: Extracts functions, classes, interfaces, types
- **Dependency Graphs**: Tracks file dependencies and impact
- **Code Maps**: Semantic understanding of codebase structure
- **Git History**: Evolution, blame, and change patterns

### 2. Memory-Aware Orchestration

BuilderForceAgents now integrates with the structured memory index:

- **index-memory**: Build or rebuild `.builderforce/memory-index.json` from daily logs
- **suggest-memory**: Run advisory scan for stale entries, duplicates, and semantic clusters
- **share-memory**: Opt-in push of index to peer agentNodes (requires `.builderforce/memory-sync/config.yaml`)
- **delegate-to <agentNodeId>**: Route specific subtasks to specialized agentNodes in the fleet

The memory index enables:

- Fast lookup of past decisions and lessons
- Cross-agentNode coordination (when sharing enabled)
- Automated suggestion scans (non-destructive)
- Pre-task context enrichment (fetches relevant past entries)

### 3. Multi-Agent Orchestration

Coordinate specialized agents for complex tasks:

- **Feature Workflow**: Architecture Advisor → Code Creator → Test Generator → Code Reviewer
- **Bug Fix Workflow**: Bug Analyzer → Code Creator → Test Generator → Code Reviewer
- **Refactor Workflow**: Code Reviewer → Refactor Agent → Test Generator
- **Custom Workflows**: Define your own multi-step coordination

### 4. Multi-AgentNode Fleet Orchestration

Distribute work across peer BuilderForceAgents instances in the same tenant:

- **Explicit routing**: `remote:<agentNodeId>` — delegate a workflow step to a named peer agentNode
- **Auto-routing**: `remote:auto` — orchestrator automatically selects the best available online peer
- **Capability routing**: `remote:auto[gpu,high-memory]` — select a peer that satisfies ALL listed capabilities
- **Fleet discovery**: `agent_fleet` tool lists all peers with IDs, online status, and capabilities
- **Capability filtering**: `agent_fleet requireCapabilities:["gpu"]` returns only matching agentNodes

```
# Discover available agentNodes
agent_fleet projectRoot:/path/to/project onlineOnly:true

# Discover agentNodes with specific capabilities
agent_fleet projectRoot:/path/to/project requireCapabilities:["gpu","high-memory"]

# Route workflow step to any available peer
orchestrate workflow:feature description:"Run GPU-intensive analysis" customSteps:[
  { role: "remote:auto[gpu]", task: "Run model training job" }
]
```

### 4. Specialized Agent Roles

Built-in developer-focused agents:

- **code-creator**: Implements features and generates code
- **code-reviewer**: Reviews for quality, security, performance
- **test-generator**: Creates comprehensive test suites
- **bug-analyzer**: Diagnoses and fixes bugs systematically
- **refactor-agent**: Improves structure while preserving behavior
- **documentation-agent**: Creates clear documentation
- **architecture-advisor**: Provides design guidance

## Workflows

### Feature Development

```
orchestrate workflow:feature description:"Add WebSocket support for real-time updates"
```

This automatically:

1. Analyzes architecture for the feature
2. Implements the code
3. Generates tests
4. Reviews the implementation

### Bug Fixing

```
orchestrate workflow:bugfix description:"Fix race condition in cache invalidation"
```

This automatically:

1. Diagnoses the bug
2. Implements the fix
3. Creates regression tests
4. Reviews the fix

### Refactoring

```
orchestrate workflow:refactor description:"Refactor authentication module"
```

This automatically:

1. Identifies refactoring opportunities
2. Performs refactoring
3. Ensures test coverage

### Custom Workflows

Define your own steps:

```
orchestrate workflow:custom description:"Add payment processing" customSteps:[
{
role: "architecture-advisor",
task: "Design payment processing architecture"
},
{
role: "code-creator",
task: "Implement payment API endpoints",
dependsOn: ["Design payment processing architecture"]
},
{
role: "test-generator",
task: "Create payment tests including edge cases",
dependsOn: ["Implement payment API endpoints"]
},
{
role: "documentation-agent",
task: "Document payment API",
dependsOn: ["Implement payment API endpoints"]
},
{
role: "code-reviewer",
task: "Review payment implementation for security",
dependsOn: ["Create payment tests including edge cases", "Document payment API"]
}
]
```

## Project Configuration

### context.yaml

Project metadata and structure:

```yaml
version: 1
projectName: my-app
description: A web application
author: builderForceAgents
author-url: https://builderforce.ai
languages:

- typescript
- javascript
  frameworks:
- express
- react
  architecture:
  style: layered
  layers: - presentation - business-logic - data-access
  patterns: - dependency-injection - repository-pattern
  buildSystem: webpack
  testFramework: vitest
```

### rules.yaml

Coding standards and conventions:

```yaml
version: 1
codeStyle:
indentation: spaces
indentSize: 2
lineLength: 100
testing:
required: true
coverage: 80
frameworks: - vitest
documentation:
required: true
format: markdown
location: docs/
git:
branchNaming: "feature/_, fix/_, docs/\*"
commitFormat: conventional
requireReview: true
```

### architecture.md

High-level design documentation:

```markdown
# Architecture

## Overview

This project follows a layered architecture with clear separation of concerns.

## Layers

### Presentation Layer

- Express routes and controllers
- Input validation
- Response formatting

### Business Logic Layer

- Domain models
- Business rules
- Service orchestration

### Data Access Layer

- Database queries
- External API calls
- Caching logic
```

## Custom Agents

Create project-specific agent roles in `.builderforce/personas/`:

```yaml

# .builderforce/personas/database-expert.yaml

name: database-expert
description: Specialist in database design and optimization
author: builderForceAgents
author-url: https://builderforce.ai
capabilities:

- Design database schemas
- Write optimized queries
- Create migrations
- Optimize performance
  tools:
- create
- edit
- view
- bash
- code_analysis
  systemPrompt: |
  You are a database expert for this project.
  Focus on schema design, query optimization, and data integrity.
  Use PostgreSQL best practices and follow the migration strategy in docs/database.md.
  model: anthropic/claude-sonnet-4-20250514
  thinking: medium
```

## Integration Patterns

### With Existing Skills

Combine builderForceAgents with other BuilderForceAgents skills:

```bash

# Use coding-agent for interactive work

bash pty:true workdir:~/project command:"codex exec 'Implement feature X'"

# Use builderForceAgents orchestration for complex workflows

orchestrate workflow:feature description:"Feature X"
```

### With Memory System

builderForceAgents integrates with BuilderForceAgents's memory:

- Project knowledge stored in `.builderforce/memory/`
- Semantic search available via memory tool
- Code maps cached for fast retrieval

### With Subagents

Workflows spawn subagents automatically:

- Each workflow step creates a subagent
- Subagents tracked via existing registry
- Results aggregated and passed between steps

## Troubleshooting

### Project Not Initialized

```
Error: No project knowledge found. Initialize with 'builderforce init' first.
```

Solution: Run `builderforce init` in your project directory.

### Code Analysis Fails

```
Error: Failed to analyze code
```

Common causes:

- Invalid TypeScript syntax
- Missing node_modules
- Circular dependencies

Solution: Fix syntax errors and ensure dependencies are installed.

### Workflow Stuck

```
Error: Workflow stuck - cannot execute remaining tasks
```

Cause: Circular task dependencies

Solution: Review custom workflow dependencies and remove cycles.

## Examples

### Analyze a Codebase

```
code_analysis projectRoot:~/projects/my-app filePatterns:["**/*.ts"]
```

### Find Who Changed a File

```
git_history projectRoot:~/projects/my-app path:src/api/auth.ts limit:10
```

### Build a Feature with Full Workflow

```
orchestrate workflow:feature description:"Add OAuth2 authentication with Google and GitHub providers"
```

### Create Custom Agent for Your Stack

```yaml

# .builderforce/personas/frontend-specialist.yaml

name: frontend-specialist
description: Expert in React and modern frontend development
author: builderForceAgents
author-url: https://builderforce.ai
capabilities:

- Build React components
- Manage state with Redux/Context
- Implement responsive designs
- Write Storybook stories
- Create frontend tests
  tools:
- create
- edit
- view
- bash
- code_analysis
  systemPrompt: |
  You are a frontend specialist using React, TypeScript, and Tailwind CSS.

Follow these principles:

- Component composition over inheritance
- Hooks for state and side effects
- Prop drilling is OK for 1-2 levels
- Use Context for deep prop passing
- Co-locate tests with components
- Write accessible HTML
- Mobile-first responsive design
  model: anthropic/claude-sonnet-4-20250514
  thinking: medium
```

## Tips

1. **Start with analysis**: Use `code_analysis` to understand a codebase before making changes
2. **Check git history**: Use `git_history` to understand how code evolved
3. **Query context first**: Use `project_knowledge` to understand project rules and architecture
4. **Use workflows for multi-step tasks**: Orchestration handles coordination automatically
5. **Define custom agents**: Create specialized roles for your tech stack
6. **Monitor workflows**: Use `workflow_status` to track progress
7. **Keep context updated**: Update `.builderforce/` files as your project evolves

## Related

- [Coding Agent Skill](../skills/coding-agent.md) - Interactive development with Codex/Claude/Pi
- [Subagents](../agents/subagents.md) - Lower-level subagent spawning
- [Skills](../tools/plugin.md) - Custom skill development
- [Memory](../memory/README.md) - Knowledge persistence
