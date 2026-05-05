---
title: "CoderClaw Workflow Patterns"
---

# CoderClaw Workflow Patterns

This document describes the built-in and custom workflow patterns available in CoderClaw's multi-agent orchestration system.

## Overview

Workflow patterns define how multiple agents coordinate to accomplish complex development tasks. Each pattern specifies:

- **Agent roles** involved in the workflow
- **Task dependencies** between agents
- **Execution order** (serial or parallel)
- **Result aggregation** strategy

## Built-in Patterns

### 1. Feature Development Pattern

**Purpose**: Implement a new feature with proper design, testing, and review.

**Agent Flow**:

```
Architecture Advisor → Code Creator → (Test Generator || Code Reviewer)
```

**Execution**:

1. Architecture Advisor analyzes requirements and proposes design
2. Code Creator implements the feature based on design
3. Test Generator creates tests (runs in parallel with review)
4. Code Reviewer checks implementation (runs in parallel with tests)

**Usage**:

```bash
coderclaw agent --message "Create user authentication feature" --thinking high
```

Or via tool:

```
orchestrate workflow:feature description:"Add WebSocket support for real-time updates"
```

**Example Output**:

```
Workflow: Feature Development
├─ [✓] Architecture Advisor: Design analysis complete
│   └─ Proposed: JWT-based authentication with refresh tokens
├─ [✓] Code Creator: Implementation complete
│   └─ Files: auth.ts, auth.test.ts, middleware.ts
├─ [✓] Test Generator: Tests created (parallel)
│   └─ Coverage: 95% (47/50 lines)
└─ [✓] Code Reviewer: Review complete (parallel)
    └─ Issues: 0 critical, 1 minor (consider rate limiting)
```

### 2. Bug Fix Pattern

**Purpose**: Systematically diagnose and fix bugs with validation.

**Agent Flow**:

```
Bug Analyzer → Code Creator → (Test Generator || Code Reviewer)
```

**Execution**:

1. Bug Analyzer diagnoses the issue and identifies root cause
2. Code Creator implements the fix
3. Test Generator creates regression tests (parallel with review)
4. Code Reviewer validates the fix (parallel with tests)

**Usage**:

```bash
coderclaw agent --message "Fix the memory leak in the parser" --thinking high
```

Or via tool:

```
orchestrate workflow:bugfix description:"Fix race condition in cache invalidation"
```

**Example Output**:

```
Workflow: Bug Fix
├─ [✓] Bug Analyzer: Root cause identified
│   └─ Issue: Unclosed file handles in parser cleanup
├─ [✓] Code Creator: Fix implemented
│   └─ Changes: parser.ts (added finally block)
├─ [✓] Test Generator: Regression tests added (parallel)
│   └─ Tests: 3 new tests for cleanup scenarios
└─ [✓] Code Reviewer: Fix validated (parallel)
    └─ Confirmed: Memory leak resolved, no new issues
```

### 3. Refactoring Pattern

**Purpose**: Improve code structure while preserving behavior.

**Agent Flow**:

```
Code Reviewer → Refactor Agent → Test Generator
```

**Execution**:

1. Code Reviewer identifies code smells and improvement opportunities
2. Refactor Agent implements structural improvements
3. Test Generator creates tests to validate behavior preservation

**Usage**:

```bash
coderclaw agent --message "Refactor the authentication module" --thinking high
```

Or via tool:

```
orchestrate workflow:refactor description:"Improve modularity of API layer"
```

**Example Output**:

```
Workflow: Refactoring
├─ [✓] Code Reviewer: Analysis complete
│   └─ Found: High coupling, duplicated logic, complex functions
├─ [✓] Refactor Agent: Refactoring complete
│   └─ Improvements: Extracted 3 utilities, simplified 5 functions
└─ [✓] Test Generator: Validation tests added
    └─ Status: All tests pass, behavior preserved
```

### 4. Code Review Pattern

**Purpose**: Comprehensive code review for quality, security, and performance.

**Agent Flow**:

```
Code Reviewer → (Documentation Agent || Test Generator)
```

**Execution**:

1. Code Reviewer performs thorough analysis
2. Documentation Agent updates docs if needed (parallel with tests)
3. Test Generator adds missing test coverage (parallel with docs)

**Usage**:

```bash
coderclaw agent --message "Review the latest changes for security issues" --thinking high
```

**Example Output**:

```
Workflow: Code Review
├─ [✓] Code Reviewer: Review complete
│   ├─ Security: 1 issue (SQL injection vulnerability)
│   ├─ Performance: 2 improvements suggested
│   └─ Quality: 3 minor issues
├─ [✓] Documentation Agent: Docs updated (parallel)
│   └─ Updated: API documentation for new endpoints
└─ [✓] Test Generator: Coverage improved (parallel)
    └─ Added: 8 tests for edge cases
```

### 5. Documentation Pattern

**Purpose**: Create comprehensive documentation for code or features.

**Agent Flow**:

```
Code Reviewer → Documentation Agent → Test Generator
```

**Execution**:

1. Code Reviewer analyzes code to understand functionality
2. Documentation Agent creates documentation
3. Test Generator adds example tests that serve as documentation

**Usage**:

```bash
coderclaw agent --message "Document the API endpoints" --thinking medium
```

**Example Output**:

```
Workflow: Documentation
├─ [✓] Code Reviewer: Code analysis complete
│   └─ Identified: 12 endpoints, 4 models, authentication flow
├─ [✓] Documentation Agent: Documentation created
│   └─ Created: api-reference.md with examples
└─ [✓] Test Generator: Example tests added
    └─ Created: examples.test.ts with usage patterns
```

## Custom Workflow Patterns

Define custom workflows for project-specific needs.

### Structure

```typescript
type WorkflowStep = {
  role: string; // Agent role name
  task: string; // Task description
  dependsOn?: string[]; // Dependencies (task descriptions)
};

type Workflow = {
  id: string;
  steps: WorkflowStep[];
};
```

### Example: API Development Workflow

```typescript
const apiDevelopmentWorkflow: WorkflowStep[] = [
  {
    role: "architecture-advisor",
    task: "Design API endpoints and data models",
    dependsOn: [],
  },
  {
    role: "code-creator",
    task: "Implement API endpoints",
    dependsOn: ["Design API endpoints and data models"],
  },
  {
    role: "documentation-agent",
    task: "Create OpenAPI/Swagger specification",
    dependsOn: ["Implement API endpoints"],
  },
  {
    role: "test-generator",
    task: "Create integration tests for all endpoints",
    dependsOn: ["Implement API endpoints"],
  },
  {
    role: "code-reviewer",
    task: "Review API implementation for security",
    dependsOn: ["Implement API endpoints", "Create integration tests for all endpoints"],
  },
];
```

**Usage**:

```
orchestrate workflow:custom description:"Build RESTful API" customSteps:[...]
```

### Example: Database Migration Workflow

```typescript
const dbMigrationWorkflow: WorkflowStep[] = [
  {
    role: "architecture-advisor",
    task: "Analyze impact of schema changes",
    dependsOn: [],
  },
  {
    role: "code-creator",
    task: "Create migration scripts (up and down)",
    dependsOn: ["Analyze impact of schema changes"],
  },
  {
    role: "test-generator",
    task: "Create migration test suite",
    dependsOn: ["Create migration scripts (up and down)"],
  },
  {
    role: "code-reviewer",
    task: "Review migrations for data safety",
    dependsOn: ["Create migration scripts (up and down)", "Create migration test suite"],
  },
  {
    role: "documentation-agent",
    task: "Document migration process and rollback procedure",
    dependsOn: ["Review migrations for data safety"],
  },
];
```

### Example: Performance Optimization Workflow

```typescript
const performanceWorkflow: WorkflowStep[] = [
  {
    role: "bug-analyzer",
    task: "Profile application and identify bottlenecks",
    dependsOn: [],
  },
  {
    role: "architecture-advisor",
    task: "Propose optimization strategies",
    dependsOn: ["Profile application and identify bottlenecks"],
  },
  {
    role: "refactor-agent",
    task: "Implement performance optimizations",
    dependsOn: ["Propose optimization strategies"],
  },
  {
    role: "test-generator",
    task: "Create performance benchmarks",
    dependsOn: ["Implement performance optimizations"],
  },
  {
    role: "code-reviewer",
    task: "Validate optimizations and measure improvements",
    dependsOn: ["Create performance benchmarks"],
  },
];
```

## Workflow Execution

### State Machine

Each workflow task follows a state machine:

```
PENDING → PLANNING → RUNNING → COMPLETED
                       ↓
                    FAILED
                       ↓
                  (retry or cancel)
```

### Progress Tracking

Monitor workflow progress:

```bash
# Get workflow status
coderclaw agent --message "What's the status of workflow abc-123?" --thinking low

# Via tool
workflow_status workflowId:abc-123-def
```

### Result Aggregation

Results from all agents are aggregated into a structured summary:

```json
{
  "workflowId": "abc-123-def",
  "status": "completed",
  "totalTasks": 4,
  "completedTasks": 4,
  "results": {
    "architecture-advisor": {
      "status": "completed",
      "summary": "Proposed JWT-based authentication",
      "artifacts": ["design-doc.md"]
    },
    "code-creator": {
      "status": "completed",
      "summary": "Implemented authentication endpoints",
      "artifacts": ["auth.ts", "middleware.ts"]
    },
    "test-generator": {
      "status": "completed",
      "summary": "Created 15 tests with 95% coverage",
      "artifacts": ["auth.test.ts"]
    },
    "code-reviewer": {
      "status": "completed",
      "summary": "1 minor issue found (consider rate limiting)",
      "artifacts": ["review-notes.md"]
    }
  }
}
```

### 6. Planning Pattern

**Purpose**: Produce a PRD, architecture specification, and ordered task list before writing any code. Use this at the start of any major feature or project so every agent downstream has a shared, written plan.

**Agent Flow**:

```
Architecture Advisor (PRD) → Architecture Advisor (Spec) → Architecture Advisor (Task Breakdown)
```

**Execution**:

1. Architecture Advisor writes a full Product Requirements Document
2. Architecture Advisor drafts the detailed architecture specification
3. Architecture Advisor decomposes the spec into a dependency-ordered task list

**Usage**:

```bash
coderclaw agent --message "Plan a real-time collaboration feature" --thinking high
```

Or via tool:

```
orchestrate workflow:planning goal:"Add real-time collaboration to the editor"
```

**Example Output**:

```
Workflow: Planning
├─ [✓] Architecture Advisor (PRD): Requirements documented
│   └─ Artifacts: prd-realtime-collab.md
├─ [✓] Architecture Advisor (Spec): Architecture defined
│   └─ Artifacts: architecture-realtime-collab.md
└─ [✓] Architecture Advisor (Tasks): Work items created
    └─ 12 tasks across 4 milestones, all dependencies mapped
```

### 7. Adversarial Review Pattern

**Purpose**: Have one agent propose a design and a second agent critique it for gaps and blind spots, then synthesize the final version. No external tool required.

**Agent Flow**:

```
Architecture Advisor (Proposal) → Code Reviewer (Critique) → Architecture Advisor (Revised)
```

**Execution**:

1. Architecture Advisor produces an initial proposal
2. Code Reviewer critiques the proposal — finds gaps, errors, and unstated assumptions
3. Architecture Advisor synthesizes the critique into a final, improved proposal

**Usage**:

```bash
coderclaw agent --message "Adversarially review the API authentication design" --thinking high
```

Or via tool:

```
orchestrate workflow:adversarial-review subject:"API authentication design"
```

**Example Output**:

```
Workflow: Adversarial Review
├─ [✓] Architecture Advisor: Initial proposal complete
│   └─ Proposed: OAuth 2.0 + PKCE with short-lived JWTs
├─ [✓] Code Reviewer: Critique complete
│   └─ Found: No refresh-token rotation, missing rate limiting, unclear error codes
└─ [✓] Architecture Advisor: Revised proposal complete
    └─ All 3 gaps addressed, final spec saved to adversarial-review.md
```

### 8. Session Handoff

CoderClaw stores session context in `.coderClaw/sessions/` so any agent session can pick up exactly where the last one stopped — no need to replay history or re-explain the project.

**At the end of a session**, save a handoff:

```bash
coderclaw agent --message "Save a session handoff for what we accomplished today" --thinking low
```

The agent writes a YAML file to `.coderClaw/sessions/<session-id>.yaml` containing:

- `summary` — one-paragraph description of what was done
- `decisions` — key choices made
- `nextSteps` — concrete follow-on tasks
- `openQuestions` — unresolved items
- `artifacts` — files or docs produced

**At the start of the next session**, the agent automatically loads the latest handoff:

```bash
coderclaw agent --message "Resume from the last session" --thinking low
```

CoderClaw reads `.coderClaw/sessions/` and surfaces the most recent handoff as starting context.

## Best Practices

### 1. Choose the Right Pattern

- **Feature**: New functionality from scratch
- **Bug Fix**: Known issue to diagnose and fix
- **Refactoring**: Improve existing code structure
- **Planning**: Major new features or projects — produce PRD, architecture spec, and task list before writing code
- **Adversarial Review**: High-stakes designs or specs — get a built-in critique pass to find blind spots
- **Review**: Validate existing code
- **Documentation**: Create or update docs

### 2. Define Clear Task Descriptions

Good:

```
"Implement JWT-based authentication with refresh tokens"
"Fix memory leak in parser cleanup logic"
"Refactor API layer to reduce coupling"
```

Bad:

```
"Add auth" (too vague)
"Fix bug" (no context)
"Make it better" (unclear goal)
```

### 3. Leverage Parallel Execution

Tasks without dependencies run in parallel:

```typescript
[
  { role: "test-generator", task: "Create tests", dependsOn: ["implement"] },
  { role: "code-reviewer", task: "Review code", dependsOn: ["implement"] },
];
// Both run simultaneously after "implement" completes
```

### 4. Monitor and Iterate

- Check workflow status regularly
- Review intermediate results
- Adjust approach if needed
- Iterate on findings

### 5. Document Custom Workflows

Save successful custom workflows for reuse:

```yaml
# .coderClaw/workflows/api-development.yaml
name: api-development
description: Complete API development workflow
steps:
  - role: architecture-advisor
    task: Design API
  - role: code-creator
    task: Implement API
    dependsOn: [Design API]
  # ... rest of steps
```

## Project-Specific Patterns

Define project-specific workflow patterns in `.coderClaw/workflows/`:

```yaml
# .coderClaw/workflows/pr-review.yaml
name: pr-review
description: Automated PR review workflow
steps:
  - role: code-reviewer
    task: Review code for quality and security
  - role: test-generator
    task: Check test coverage and add missing tests
    dependsOn: [Review code for quality and security]
  - role: documentation-agent
    task: Update documentation if needed
    dependsOn: [Review code for quality and security]
```

Load and execute:

```bash
coderclaw agent --message "Run PR review workflow for the latest changes"
```

## Integration with CI/CD

CoderClaw workflows can be integrated into CI/CD pipelines:

### GitHub Actions Example

```yaml
name: CoderClaw Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install CoderClaw
        run: npm install -g coderclaw
      - name: Run Review Workflow
        run: |
          coderclaw init
          coderclaw agent --message "Review PR changes" > review.txt
      - name: Comment on PR
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const review = fs.readFileSync('review.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: review
            });
```

## Future Enhancements

Planned workflow features:

- **Conditional Branching**: Execute different paths based on results
- **Loop Support**: Retry tasks until success criteria met
- **Human-in-the-Loop**: Pause for manual approval
- **Workflow Templates**: Library of reusable patterns
- **Workflow Visualization**: Graphical representation of execution
- **Performance Metrics**: Track workflow execution times
- **Workflow Marketplace**: Share patterns with community

## Summary

CoderClaw's workflow patterns enable:

- **Systematic Development**: Structured approach to complex tasks
- **Quality Assurance**: Built-in review and testing steps
- **Parallel Efficiency**: Run independent tasks simultaneously
- **Flexibility**: Custom workflows for specific needs
- **Repeatability**: Consistent execution of proven patterns

Choose built-in patterns for common scenarios or define custom workflows for project-specific needs.
