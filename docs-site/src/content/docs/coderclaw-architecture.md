---
title: "CoderClaw Architecture"
---

# CoderClaw Architecture

This document describes the architectural design and implementation of CoderClaw, the multi-agent developer system.

## System Overview

CoderClaw is designed as an **orchestration engine** that sits inside developer workflows, providing:

1. **Deep codebase understanding** through AST parsing and semantic analysis
2. **Intelligent agent coordination** for complex development tasks
3. **Persistent project context** stored in `.coderClaw/` directories
4. **Extensible agent roles** that can be customized per project
5. **Distributed execution** with security boundaries

## Architecture Layers

### Layer 1: Knowledge Engine

The foundation layer responsible for understanding code structure and context.

#### Knowledge Engine Components

**AST Parser (`src/coderclaw/ast-parser.ts`)**

- Parses TypeScript/JavaScript files using TypeScript Compiler API
- Extracts semantic information: functions, classes, interfaces, types
- Tracks visibility, parameters, return types, modifiers
- Exports metadata for downstream analysis

**Code Map Builder (`src/coderclaw/code-map.ts`)**

- Builds semantic code maps across entire projects
- Tracks import/export relationships
- Creates dependency graphs
- Calculates impact radius for changes
- Identifies coupling and module boundaries

**Git History Tool (`src/coderclaw/tools/git-history-tool.ts`)**

- Analyzes commit history via native git commands
- Tracks file evolution and authorship
- Identifies change patterns and hotspots
- Provides data for refactoring decisions

**Project Context (`src/coderclaw/project-context.ts`)**

- Manages `.coderClaw/` directory structure
- Loads/saves project metadata, rules, architecture
- Handles custom agent role definitions
- Provides persistence layer for project knowledge

#### Data Flow

```
Source Files → AST Parser → File Metadata
              ↓
          Code Map Builder → Dependency Graph
              ↓
         Git History → Change Patterns
              ↓
      Project Context → Persistent Storage (.coderClaw/)
```

### Layer 2: Agent System

The middle layer responsible for agent role definitions and capabilities.

#### Agent System Components

**Agent Roles (`src/coderclaw/agent-roles.ts`)**

- Defines 7 built-in agent roles
- Specifies capabilities, tools, system prompts
- Provides role lookup and discovery
- Supports custom role extensions

**Built-in Roles:**

1. **Code Creator**: Feature implementation
2. **Code Reviewer**: Quality and security review
3. **Test Generator**: Comprehensive test creation
4. **Bug Analyzer**: Systematic debugging
5. **Refactor Agent**: Structure improvement
6. **Documentation Agent**: Clear documentation
7. **Architecture Advisor**: Design guidance

**Custom Agent Loading**

- Loads YAML definitions from `.coderclaw/personas/`
- Merges with built-in roles
- Supports project-specific agent definitions
- Enables community-driven agent libraries

#### Agent Lifecycle

```
Agent Request → Role Selection → Capability Check
                                      ↓
                               Tool Access Grant
                                      ↓
                               Execution Context
                                      ↓
                               Result Collection
```

### Layer 3: Orchestration Engine

The top layer responsible for coordinating multiple agents.

#### Orchestration Engine Components

**Orchestrator (`src/coderclaw/orchestrator.ts`)**

- Active workflow engine — `createWorkflow()` + `executeWorkflow()` both wired
- Dependency-aware task scheduling (DAG)
- Marks workflow status: `running` → `completed` / `failed`
- Supports: `feature`, `bugfix`, `refactor`, `custom` workflow types

**Enhanced Orchestrator (`src/coderclaw/orchestrator-enhanced.ts`)**

- Extended workflow types: `planning` and `adversarial` review
- Distributed orchestration hooks (Phase 2 target)
- Not yet wired into the `orchestrate` tool switch — uses main `orchestrator.ts` today

**Task Engine (`src/transport/task-engine.ts`)**

- Manages distributed task lifecycle
- State machine: PENDING → PLANNING → RUNNING → COMPLETED
- Event logging and audit trails
- Resumable execution support
- Progress tracking

**Workflow Patterns**

- Active (wired to `orchestrate` tool): `feature`, `bugfix`, `refactor`, `custom`
- Implemented but not yet wired: `planning`, `adversarial` (in `orchestrator-enhanced.ts`)
- Dependency resolution via DAG
- Parallel execution where possible

#### Orchestration Flow

```
Workflow Request → Step Definition → Dependency Analysis
                                           ↓
                                    Task Scheduling
                                           ↓
                                    Agent Spawning
                                           ↓
                                    Execution Monitoring
                                           ↓
                                    Result Aggregation
```

### Layer 4: Integration Layer

The outer layer connecting to CoderClaw infrastructure.

#### Integration Layer Components

**Tool System Integration**

- Uses CoderClaw's `AgentTool` interface
- Registers coderClaw tools: `code_analysis`, `project_knowledge`, `git_history`, `orchestrate`, `workflow_status`
- Follows CoderClaw tool conventions

**Subagent Integration**

- Leverages CoderClaw's subagent spawning
- Integrates with session management
- Respects tool policy and security boundaries

**Transport Layer**

- `ClawLinkTransportAdapter` — HTTP task lifecycle (`/api/runtime/executions`)
- `ClawLinkRelayService` (`src/infra/clawlink-relay.ts`) — persistent upstream WebSocket relay:
  - Connects to `ClawRelayDO` at `wss://api.builderforce.ai/api/claws/:id/upstream`
  - Bridges browser chat ↔ local gateway in real time
  - Sends HTTP heartbeat every 5 minutes to keep `lastSeenAt` current
  - Auto-reconnects with exponential backoff on disconnect
- `ClawLinkDirectorySync` (`src/infra/clawlink-directory-sync.ts`) — uploads `.coderClaw/` files to the API on gateway boot

**Security Service**

- RBAC enforcement
- Device trust verification
- Session-level permissions
- Audit logging

#### Integration Points

```
CoderClaw Tools ←→ CoderClaw Tool System
Orchestrator ←→ CoderClaw Subagent Spawning
Task Engine ←→ Transport Layer
Security ←→ CoderClaw Security Service
```

## Data Structures

### Project Context (.coderClaw/context.yaml)

```yaml
version: 1
projectName: my-project
description: Project description
rootPath: /path/to/project
languages:
  - typescript
  - javascript
frameworks:
  - express
  - react
architecture:
  style: layered
  layers:
    - presentation
    - business
    - data
  patterns:
    - mvc
    - repository
buildSystem: npm
testFramework: vitest
lintingTools:
  - eslint
  - prettier
dependencies:
  production:
    express: ^4.18.0
  development:
    vitest: ^1.0.0
customRules:
  - No direct database access from controllers
metadata:
  createdAt: 2026-02-19
```

### Project Rules (.coderClaw/rules.yaml)

```yaml
version: 1
codeStyle:
  indentation: spaces
  indentSize: 2
  lineLength: 100
  namingConventions:
    classes: PascalCase
    functions: camelCase
testing:
  required: true
  coverage: 80
  frameworks:
    - vitest
documentation:
  required: true
  format: markdown
  location: docs/
git:
  branchNaming: "feature/*, fix/*, docs/*"
  commitFormat: conventional
  requireReview: true
constraints:
  - Must pass all tests before commit
  - Must maintain 80% code coverage
customRules:
  - Use async/await instead of promises
```

### Custom Agent Role (.coderclaw/personas/custom.yaml)

```yaml
name: custom-agent
description: Project-specific agent
capabilities:
  - Capability 1
  - Capability 2
tools:
  - create
  - edit
  - view
systemPrompt: |
  You are a custom agent.
  Follow project-specific guidelines.
model: anthropic/claude-sonnet-4-20250514
thinking: medium
constraints:
  - Must follow constraint 1
```

### Code Map Structure

```typescript
type CodeMap = {
  files: Map<string, FileInfo>;
  dependencies: Map<string, string[]>;
  exports: Map<string, ExportInfo>;
  imports: Map<string, ImportInfo[]>;
};

type FileInfo = {
  path: string;
  language: string;
  size: number;
  lastModified: Date;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  interfaces: InterfaceInfo[];
  types: TypeInfo[];
};

type DependencyNode = {
  file: string;
  dependencies: string[];
  dependents: string[];
};
```

### Task State

```typescript
type TaskState = {
  id: string; // UUID
  description: string;
  agentId?: string;
  status: TaskStatus; // pending, planning, running, completed, failed, cancelled
  input?: string;
  output?: string;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  progress?: number; // 0-100
  metadata?: Record<string, unknown>;
};
```

## Execution Flow

### Project Initialization

```
1. User runs `coderclaw init`
2. CLI prompts for project information
3. Create .coderClaw/ directory structure
4. Generate default context.yaml
5. Generate default architecture.md
6. Generate default rules.yaml
7. Create personas/, skills/, memory/ subdirectories
8. Write README.md explaining structure
```

### Code Analysis Request

```
1. Agent receives code analysis request
2. Load project context from .coderClaw/
3. Parse relevant source files with AST parser
4. Build code map with dependencies
5. Generate dependency graph
6. Calculate metrics (coupling, complexity)
7. Format and return structured results
```

### Multi-Agent Workflow

```
1. User requests feature development
2. Orchestrator loads workflow pattern
3. Identify required agents (Architecture Advisor, Code Creator, Test Generator, Reviewer)
4. Create workflow with task dependencies
5. Spawn Architecture Advisor → analyze design
6. Spawn Code Creator → implement feature (depends on analysis)
7. Spawn Test Generator → create tests (depends on implementation)
8. Spawn Code Reviewer → review code (depends on implementation)
9. Aggregate results from all agents
10. Present combined output to user
```

### Git-Aware Refactoring

```
1. Load git history for target files
2. Identify change patterns and hotspots
3. Calculate file coupling metrics
4. Spawn Refactor Agent with context
5. Agent proposes refactoring strategy
6. Validate with Test Generator
7. Execute refactoring
8. Verify tests still pass
```

## Technology Choices

### Why TypeScript?

- Strong typing for tool interfaces
- Excellent AST support via TypeScript Compiler API
- Familiar to most developers
- Good performance for orchestration tasks

### Why YAML for Configuration?

- Human-readable and editable
- Standard format for project config
- Good tool support
- Easy to version control

### Why Markdown for Documentation?

- Universal format
- Git-friendly
- Renders well in all viewers
- Easy to edit

### Why SQLite for Memory?

- Embedded database, no server needed
- ACID transactions
- Good query performance
- Portable files

## Security Considerations

### Sandboxing

- Code analysis runs with same permissions as other tools
- No arbitrary code execution during analysis
- Project context files are read-only during execution

### RBAC Integration

- Workflow execution respects CoderClaw's tool policy
- Agent spawning follows security boundaries
- Distributed execution requires authentication

### Data Privacy

- Project context stays local by default
- No external network access during analysis
- Git history analyzed locally
- Optional remote orchestration with encryption

## Performance Optimization

### Caching

- Parsed AST results cached in memory
- Code maps incrementally updated
- Git history cached with invalidation

### Incremental Analysis

- Only re-parse changed files
- Update dependency graph incrementally
- Track file modification times

### Parallel Execution

- Independent agents run in parallel
- AST parsing parallelized per file
- Workflow tasks respect dependencies

## Extensibility Points

### 1. Language Support

Add new AST parsers in `src/coderclaw/`:

```typescript
export async function parsePythonFile(filePath: string): Promise<FileInfo>;
```

### 2. Custom Agents

Define YAML in `.coderclaw/personas/`:

```yaml
name: my-agent
capabilities: [...]
```

### 3. Custom Tools

Add to `.coderClaw/skills/`:

```typescript
export const myTool: AgentTool = {
  name: "my_tool",
  execute: async () => { ... }
};
```

### 4. Transport Adapters

Implement `RuntimeInterface`:

```typescript
class HTTPTransportAdapter implements RuntimeInterface {
  async submitTask(request: TaskSubmitRequest): Promise<TaskState> { ... }
}
```

### 5. Workflow Patterns

Define in orchestrator:

```typescript
const customWorkflow: WorkflowPattern = {
  name: "custom",
  steps: [...]
};
```

## Testing Strategy

### Unit Tests

- AST parser: Parse sample files, verify structure
- Code map: Build graphs, verify dependencies
- Agent roles: Validate role definitions
- Orchestrator: Test workflow creation and execution

### Integration Tests

- Full workflow execution end-to-end
- Project initialization and loading
- Multi-agent coordination
- Tool integration

### E2E Tests

- Real project analysis
- Git history integration
- Custom agent loading
- Workflow execution with real agents

## Future Architecture

### Planned Enhancements

**Multi-Language Support**

- Python AST parser (ast module)
- Go parser (go/ast package)
- Java parser (JavaParser library)
- Rust parser (syn crate)

**Real-Time Indexing**

- File system watcher integration
- Incremental re-parsing
- Live dependency updates

**IDE Integration**

- Language Server Protocol support
- Live error detection
- Real-time suggestions

**Distributed Execution**

- HTTP transport adapter
- WebSocket for streaming
- gRPC for performance
- Load balancing across nodes

**Enhanced Semantic Search**

- Natural language queries
- Vector embeddings for code
- Similarity search
- Cross-repository search

## Conclusion

CoderClaw's architecture is designed to be:

- **Modular**: Clear separation of concerns across layers
- **Extensible**: Multiple extension points for customization
- **Performant**: Caching and parallelization strategies
- **Secure**: Integrated security model with RBAC and device trust
- **Developer-Friendly**: Clear APIs and documentation

The layered design ensures that each component can evolve independently while maintaining a cohesive system.
