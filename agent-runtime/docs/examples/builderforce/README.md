# BuilderForce Agents Examples

This directory contains examples demonstrating BuilderForce Agents's multi-agent AI system for code creation, review, testing, debugging, refactoring, and deep codebase understanding.

## Examples

### 1. Project Initialization (`01-project-init.ts`)

Initialize a new project with BuilderForce Agents's persistent context engine.

### 2. Multi-Agent Workflow (`02-multi-agent-workflow.ts`)

Orchestrate multiple agents (Creator → Reviewer → Tester) working together on a feature.

### 3. Deep Code Analysis (`03-code-analysis.ts`)

Analyze codebase structure with AST parsing, dependency graphs, and semantic maps.

### 4. Git-Aware Refactoring (`04-git-aware-refactor.ts`)

Use git history and blame information to guide intelligent refactoring decisions.

### 5. Custom Agent Roles (`05-custom-agents.ts`)

Define and use custom agent roles for project-specific workflows.

## Running Examples

```bash
# Initialize a test project
npx tsx examples/builderforce/01-project-init.ts

# Run multi-agent workflow
npx tsx examples/builderforce/02-multi-agent-workflow.ts

# Analyze code structure
npx tsx examples/builderforce/03-code-analysis.ts

# Git-aware refactoring
npx tsx examples/builderforce/04-git-aware-refactor.ts

# Custom agent roles
npx tsx examples/builderforce/05-custom-agents.ts
```

## Project Structure

When you initialize a BuilderForce Agents project, it creates a `.builderforce/` directory:

```
.builderforce/
├── context.yaml          # Project metadata and dependencies
├── architecture.md       # Architectural documentation
├── rules.yaml           # Coding standards and conventions
├── agents/              # Custom agent role definitions
│   └── custom-agent.yaml
├── skills/              # Project-specific skills
│   └── project-skill.ts
└── memory/              # Persistent project knowledge
    └── semantic-index.db
```

## Key Features Demonstrated

### Deep Knowledge & Context Engine

- AST parsing across TypeScript/JavaScript
- Semantic code maps with function/class/interface discovery
- Dependency graph generation and analysis
- Cross-file reference tracking
- Git history awareness (blame, diffs, evolution)

### Multi-Agent Orchestration

- Dynamic agent spawning
- Task lifecycle management
- Result aggregation
- Iterative refinement loops
- Deterministic execution

### Developer-Centric Agent Roles

- **Code Creator**: Feature implementation
- **Code Reviewer**: Quality and security review
- **Test Generator**: Comprehensive test suites
- **Bug Analyzer**: Root cause analysis and fixes
- **Refactor Agent**: Structure improvements
- **Documentation Agent**: Clear documentation
- **Architecture Advisor**: System design guidance

### Extensibility

- Pluggable agent roles via `.builderforce/agents/`
- Custom skills per project
- Configurable rules and constraints
- Long-lived memory storage

## Integration

BuilderForce Agents integrates with existing developer workflows:

- CLI commands for initialization and status
- Git integration for history awareness
- AST parsing for deep code understanding
- Distributed task execution via transport layer
- Security boundaries with RBAC

## Next Steps

After running these examples, explore:

1. **Custom Agent Creation**: Define project-specific agents in `.builderforce/agents/`
2. **Workflow Customization**: Create complex multi-agent workflows
3. **Memory Integration**: Build persistent knowledge bases
4. **Remote Orchestration**: Use transport adapters for distributed execution
