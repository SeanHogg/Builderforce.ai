---
title: "CoderClaw: Multi-Agent Developer System"
---

# CoderClaw: Multi-Agent Developer System

coderClaw is a developer-first, multi-agent AI system designed for code creation, review, testing, debugging, refactoring, and deep codebase understanding. It operates as an **orchestration engine inside real developer workflows**.

## Vision

An AI assistant that:

- **Understands your codebase deeply** through AST parsing, semantic analysis, and dependency graphs
- **Coordinates specialized agents** to handle complex development workflows
- **Maintains persistent context** about your project's architecture, rules, and patterns
- **Integrates seamlessly** with your existing development tools and processes
- **Enables team collaboration** with secure distributed orchestration

## Why CoderClaw?

Unlike closed‑source cloud assistants, CoderClaw is self‑hosted and open‑source (MIT).
It orchestrates multiple specialized agents, maintains persistent project knowledge, and
includes enterprise‑grade security (RBAC, audit trails). You stay in control of your data and
workflows. For a side‑by‑side comparison see [CoderClaw vs Alternatives](coderclaw-vs-alternatives.md).

## Core Capabilities

### 1. Deep Knowledge & Context Engine

CoderClaw builds and maintains a persistent, structured project knowledge model:

#### AST Parsing & Semantic Analysis

- **TypeScript/JavaScript Support**: Full syntax tree parsing
- **Function Discovery**: Names, parameters, return types, visibility
- **Class Analysis**: Inheritance, interfaces, methods, properties
- **Interface Tracking**: Type definitions, extensions, properties
- **Export/Import Analysis**: Cross-file reference tracking

#### Code Maps & Dependency Graphs

- **Semantic Code Maps**: Complete file-level structure
- **Dependency Relationships**: File-to-file dependencies
- **Impact Analysis**: Calculate change radius
- **Coupling Detection**: Identify tightly coupled modules
- **Module Boundaries**: Suggest refactoring opportunities

#### Git History Awareness

- **Commit Analysis**: Track file evolution over time
- **Authorship Tracking**: Identify code ownership (git blame)
- **Change Patterns**: Detect frequently modified areas
- **Architectural Evolution**: Understand how design has changed
- **Hotspot Detection**: Find high-churn problem areas

#### Persistent Context

All project knowledge is stored in `.coderClaw/`:

- `context.yaml`: Project metadata, languages, frameworks, dependencies
- `architecture.md`: Design documentation and patterns
- `rules.yaml`: Coding standards, testing requirements, git conventions
- `agents/`: Custom agent role definitions
- `skills/`: Project-specific skills
- `memory/`: Knowledge base and semantic indices
- `sessions/`: Session handoff documents — agents write a structured summary at session end so the next session resumes instantly without replaying history

### 2. Multi-Agent Orchestration

Coordinate multiple specialized agents to work together on complex tasks:

#### Dynamic Agent Spawning

- **On-Demand Creation**: Spawn agents as needed
- **Role Selection**: Choose appropriate agent for each subtask
- **Resource Management**: Manage agent lifecycle

#### Task Lifecycle Management

- **State Machine**: PENDING → PLANNING → RUNNING → COMPLETED
- **Progress Tracking**: Real-time status updates
- **Dependency Resolution**: Respect task dependencies
- **Resumable Execution**: Handle long-running tasks
- **Audit Trail**: Complete event history

#### Workflow Patterns

Built-in patterns for common scenarios:

**Feature Development**

```
Architecture Advisor → Code Creator → Test Generator → Code Reviewer
```

**Bug Fix**

```
Bug Analyzer → Code Creator → Test Generator → Code Reviewer
```

**Refactoring**

```
Code Reviewer → Refactor Agent → Test Generator
```

**Custom Workflows**
Define your own multi-step agent coordination with dependencies.

#### Result Aggregation

- **Structured Output**: JSON schemas for tool calls
- **Summary Generation**: Combine insights from multiple agents
- **Decision Support**: Present options with trade-off analysis

#### Iterative Refinement

- **Generate → Test Loop**: Automatic validation
- **Debug → Re-run**: Fix issues and retry
- **Review → Improve**: Incorporate feedback

### 3. Specialized Agent Roles

Built-in developer-centric agents:

#### Code Creator

- **Purpose**: Implements features and generates code
- **Capabilities**:
  - Create new files and modules
  - Implement features from specifications
  - Generate boilerplate code
  - Scaffold new projects
  - Follow coding standards
- **Focus**: Clean architecture, maintainability, best practices

#### Code Reviewer

- **Purpose**: Reviews code for quality, security, performance
- **Capabilities**:
  - Identify bugs and logic errors
  - Check for security vulnerabilities
  - Assess performance implications
  - Evaluate maintainability
  - Verify coding standards
- **Focus**: Correctness, security, performance, standards

#### Test Generator

- **Purpose**: Creates comprehensive test suites
- **Capabilities**:
  - Generate unit tests
  - Create integration tests
  - Design edge case tests
  - Write test fixtures and mocks
  - Ensure test coverage
- **Focus**: Behavior testing, coverage, maintainability

#### Bug Analyzer

- **Purpose**: Diagnoses and fixes bugs systematically
- **Capabilities**:
  - Analyze error logs and stack traces
  - Trace execution flow
  - Identify root causes
  - Propose targeted fixes
  - Validate fixes with tests
- **Focus**: Root cause analysis, minimal fixes, validation

#### Refactor Agent

- **Purpose**: Improves code structure while preserving behavior
- **Capabilities**:
  - Identify code smells
  - Extract reusable functions
  - Simplify complex logic
  - Improve naming
  - Reduce duplication
- **Focus**: Maintainability, readability, behavior preservation

#### Documentation Agent

- **Purpose**: Creates clear, helpful documentation
- **Capabilities**:
  - Write API documentation
  - Create user guides
  - Document architecture
  - Generate code comments
  - Write README files
- **Focus**: Clarity, completeness, examples

#### Architecture Advisor

- **Purpose**: Provides high-level design guidance
- **Capabilities**:
  - Analyze system architecture
  - Propose architectural improvements
  - Identify design patterns
  - Evaluate scalability
  - Assess technical debt
- **Focus**: System design, patterns, scalability, trade-offs

### 4. Extensibility & Customization

#### Custom Agent Roles

Define project-specific agents in `.coderClaw/agents/`:

```yaml
# .coderClaw/agents/api-specialist.yaml
name: api-specialist
description: Expert in API design and implementation
capabilities:
  - Design RESTful APIs
  - Implement GraphQL resolvers
  - Write API documentation
  - Create API tests
tools:
  - create
  - edit
  - view
  - bash
systemPrompt: |
  You are an API specialist for this project.
  Follow the project's API conventions in docs/api-standards.md.
model: anthropic/claude-sonnet-4-20250514
thinking: medium
```

#### Project-Specific Skills

Add custom skills in `.coderClaw/skills/`:

- Domain-specific operations
- Tool integrations
- Custom workflows

#### Community Extensibility

- Share agent definitions across projects
- Build domain-specific agent libraries
- Version control agent definitions
- Publish to agent marketplaces

## Project Structure

When you initialize a coderClaw project:
CoderClaw stores project-specific context in a `.coderClaw/` directory:

```
.coderClaw/
├── context.yaml          # Project metadata and dependencies
├── architecture.md       # Architectural documentation
├── rules.yaml           # Coding standards and conventions
├── agents/              # Custom agent role definitions
│   ├── reviewer.yaml
│   └── tester.yaml
├── skills/              # Project-specific skills
│   └── project-skill.ts
├── memory/              # Persistent project knowledge
│   └── semantic-index.db
└── sessions/            # Session handoff docs — resume any session instantly
    └── <session-id>.yaml
```

## Getting Started

### Initialize a Project

```bash
# In your project directory
coderclaw init

# Or specify a path
coderclaw init /path/to/project
```

This creates the `.coderClaw/` directory with default configuration.

### Check Project Status

```bash
coderclaw project status
```

## Using coderClaw

### From Command Line

```bash
# Analyze codebase structure
coderclaw agent --message "Analyze the dependency graph" --thinking high

# Create feature with multi-agent workflow
coderclaw agent --message "Create user authentication with tests and review" --thinking high

# Fix bug with systematic approach
coderclaw agent --message "Debug the memory leak in the parser module" --thinking high

# Refactor code
coderclaw agent --message "Refactor the API module for better modularity" --thinking high
```

### From Messaging Channels

Send messages to your connected channels (WhatsApp, Telegram, Slack, Discord, etc.):

```
@coderclaw analyze the codebase structure

@coderclaw create a feature for user authentication with tests

@coderclaw review the latest changes for security issues

@coderclaw refactor the authentication module
```

### Using coderClaw Tools

Agents automatically have access to coderClaw tools in initialized projects:

#### Code Analysis

Analyze code structure and dependencies:

```
code_analysis projectRoot:/path/to/project
```

#### Project Knowledge

Query project context and rules:

```
project_knowledge projectRoot:/path/to/project query:all
project_knowledge projectRoot:/path/to/project query:rules
project_knowledge projectRoot:/path/to/project query:architecture
```

#### Git History

Analyze git history and patterns:

```
git_history projectRoot:/path/to/project
git_history projectRoot:/path/to/project path:src/api/ limit:20
git_history projectRoot:/path/to/project author:john@example.com
```

#### Orchestrate Workflows

Create multi-agent workflows:

```
# Feature development workflow
orchestrate workflow:feature description:"Add user authentication"

# Bug fix workflow
orchestrate workflow:bugfix description:"Fix memory leak in parser"

# Refactoring workflow
orchestrate workflow:refactor description:"Refactor API module"
```

#### Check Workflow Status

```
workflow_status workflowId:abc-123-def
```

## Available Workflow Patterns

### Feature Development

Coordinates: Architecture Advisor → Code Creator → Test Generator → Code Reviewer

```
orchestrate workflow:feature description:"Add WebSocket support"
```

### Bug Fix

Coordinates: Bug Analyzer → Code Creator → Test Generator → Code Reviewer

```
orchestrate workflow:bugfix description:"Fix race condition in cache"
```

### Refactoring

Coordinates: Code Reviewer → Refactor Agent → Test Generator

```
orchestrate workflow:refactor description:"Refactor authentication module"
```

### Custom Workflow

Define your own workflow steps with dependencies.

## Architecture Integration

CoderClaw's existing capabilities:

- **Skills**: Use coding-agent skill for interactive development
- **Subagents**: Orchestrate workflows spawn subagents automatically
- **Memory**: Project knowledge managed by CoderClaw's memory system
- **Tools**: CoderClaw tools available across all workflows
- **Workspace**: Project context complements workspace-level configuration
- **Transport Layer**: Distributed execution via transport adapters
- **Security**: RBAC and policy enforcement

## Architecture

CoderClaw's infrastructure includes:

### Components

- **Tool System**: Uses AgentTool interface for consistency
- **Subagent Spawning**: Leverages existing subagent lifecycle management
- **Session Management**: Integrates with CoderClaw's session tracking
- **Configuration**: Extends CoderClaw config structure
- **Transport Layer**: Protocol-agnostic execution (local or remote)
- **Security Service**: RBAC with identity and device trust

### Technology Stack

- **AST Parsing**: TypeScript Compiler API
- **Code Analysis**: Custom semantic analysis engine
- **Dependency Graphs**: Graph-based relationship tracking
- **Git Integration**: Native git command integration
- **Storage**: YAML for config, Markdown for docs, SQLite for memory

## Security

CoderClaw's security model includes:

- Project context files are read-only during execution
- Code analysis runs with same permissions as other tools
- Workflow execution follows existing tool policy
- No external network access during local code analysis
- RBAC enforcement for distributed execution
- Device trust verification
- Session-level permissions

## Best Practices

1. **Initialize projects early**: Run `coderclaw init` when starting new projects
2. **Keep context updated**: Update `architecture.md` as your design evolves
3. **Define clear rules**: Specify coding standards in `rules.yaml`
4. **Use workflows for complex tasks**: Leverage orchestration for multi-step work
5. **Create custom agents**: Define project-specific roles as needed
6. **Review workflow results**: Check task outputs and iterate as needed
7. **Version control .coderClaw**: Check in context for team collaboration
8. **Document architectural decisions**: Keep `architecture.md` current

## Examples

See [examples/coderclaw](https://github.com/SeanHogg/coderClaw/tree/main/examples/coderclaw) for comprehensive examples:

1. **Project Initialization**: Set up .coderClaw directory
2. **Multi-Agent Workflow**: Orchestrate Creator → Reviewer → Tester
3. **Deep Code Analysis**: AST parsing and dependency graphs
4. **Git-Aware Refactoring**: Use history to guide decisions
5. **Custom Agent Roles**: Define project-specific agents

## Future Enhancements

Planned features:

- **Language Support**: Python, Go, Java, Rust, C++
- **Real-time Indexing**: Watch mode for live code updates
- **IDE Integration**: Language server protocol support
- **Enhanced Semantic Search**: Natural language codebase queries
- **Automated Architecture Docs**: Generate design documentation
- **PR/Issue Awareness**: Integrate with GitHub/GitLab
- **Cross-Repository Tracking**: Multi-repo dependency analysis
- **Performance Profiling**: Integrate profiling data into analysis
- **Test Coverage Visualization**: Visual coverage reports
- **Architectural Fitness Functions**: Automated constraint checking

## Contributing

We welcome contributions! See [CONTRIBUTING.md](https://github.com/SeanHogg/coderClaw/blob/main/CONTRIBUTING.md) for guidelines.

Priority areas:

- Additional language support (AST parsers)
- New agent role templates
- Workflow pattern library
- Enhanced semantic analysis
- Documentation improvements

## License

MIT - See [LICENSE](https://github.com/SeanHogg/coderClaw/blob/main/LICENSE) for details.
