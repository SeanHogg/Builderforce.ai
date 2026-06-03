# Agent Personas — Guide

> See also: [Architecture](../ARCHITECTURE.md#persona-plugin-system) · [Business Roadmap](../BUSINESS_ROADMAP.md)

Personas are agent role definitions that shape **identity, communication style, and
decision-making** for every sub-agent spawned in a workflow. They can be:

- **Built-in** — shipped with BuilderForce Agents core (7 roles, always available)
- **Project-local** — defined in `.builderforce/personas/*.yaml` (this project only)
- **User-global** — defined in `~/.builderforce/personas/*.yaml` (all projects on this machine)
- **Marketplace** — purchased from AgentHub and installed via `agenthub install <name>`
- **builderforce.ai-assigned** — pushed to a specific agent by an operator via the portal

---

## How Personas Reach the Brain

Every sub-agent spawned by the orchestrator has its persona injected into the brain's
reasoning context:

```
1. orchestrate tool creates workflow with roles
2. orchestrator calls spawnSubagentDirect({ roleConfig })
3. subagent-spawn.ts encodes the role into the child system prompt:

   --- Role Guidance ---
   You are a Code Reviewer agent. Your role is to provide thorough...

   --- Agent Persona ---
   Role: code-reviewer
   Voice: critical yet constructive
   Perspective: all code is a future maintenance burden
   Decision style: thorough: surface all issues, ranked by severity
   Required output sections: ## Review Summary, ## Issues Found, ...
   Prefix your summary with: REVIEW:
   ---

4. The BuilderForce AgentsLLM brain receives this as context.systemPrompt
5. brainSystem = [context.systemPrompt, memory, RAG, BRAIN_SYSTEM_PROMPT]
6. Brain reasons with this identity on ALL paths (direct + DELEGATE)
7. Each sub-agent spawn = new brain instance = isolated persona
```

Sub-agent personality is **fully isolated** — a code-reviewer brain and an
architecture-advisor brain run with completely different identities, even when
spawned in the same workflow.

---

## PERSONA.yaml Format

Create a file in `.builderforce/personas/` (project) or `~/.builderforce/personas/` (global):

```yaml
# Required
name: senior-security-reviewer
description: "Adversarial security review — OWASP, supply chain, secrets"

# Optional: marketplace metadata (set by AgentHub; do not edit manually)
version: "1.0.0"
author: acme-corp
agenthubId: acme/senior-security-reviewer
license: Commercial
requiresLicense: true
marketplaceUrl: https://agenthub.ai/personas/acme/senior-security-reviewer
tags: [security, compliance, backend, owasp]

# Agent configuration
capabilities:
  - OWASP Top 10 vulnerability detection
  - Supply chain risk assessment
  - Secret scanning
  - Dependency license review

tools: [view, grep, glob, bash]
model: anthropic/claude-opus-4-20250514
thinking: high

systemPrompt: |
  You are a senior security engineer with 15+ years of experience in
  application security. You approach every code review with structured
  threat modelling and assume all external input is untrusted until proven safe.

# Persona identity — shapes how the brain reasons and communicates
persona:
  voice: "skeptical and thorough"
  perspective: "every external input is untrusted until proven safe"
  decisionStyle: "risk-first: flag all potential vulnerabilities, not just obvious ones"

# Output contract — tells downstream agents how to parse your output
outputFormat:
  structure: markdown
  requiredSections:
    - "## Security Findings"
    - "## Risk Assessment"
    - "## Remediation"
  outputPrefix: "SECURITY:"

# Hard constraints injected into every task context
constraints:
  - Never approve code with unvalidated external input
  - Flag all third-party dependencies for license review
  - Escalate any hardcoded credentials immediately
```

---

## Using a Persona in a Workflow

Reference a persona by `name` in any `orchestrate` workflow step:

```json
{
  "workflow": "custom",
  "description": "Security-focused feature review",
  "steps": [
    {
      "id": "implement",
      "role": "code-creator",
      "description": "Implement the payment handler",
      "input": "Implement Stripe webhook handler with signature validation"
    },
    {
      "id": "security-review",
      "role": "senior-security-reviewer",
      "description": "Security review of payment handler",
      "input": "Review the implementation for security vulnerabilities",
      "dependencies": ["implement"]
    }
  ]
}
```

The `senior-security-reviewer` persona is resolved from the `PersonaRegistry`
(marketplace install → project-local → user-global → built-in, in that order).

---

## Installing Personas from AgentHub

```bash
# Search the marketplace
agenthub search persona security

# Install a persona (saved to ~/.builderforce/personas/ by default)
agenthub install acme/senior-security-reviewer

# Install project-scoped
agenthub install acme/senior-security-reviewer --project

# Update
agenthub update acme/senior-security-reviewer
```

The gateway automatically loads new personas on the next startup (or `/sync`).

---

## Assigning Personas via builderforce.ai

Operators can push persona assignments to specific agents from the builderforce.ai portal.
The assignment is stored in `.builderforce/context.yaml` and activated at gateway startup:

```yaml
# .builderforce/context.yaml (managed by builderforce.ai — do not edit manually)
personas:
  assignments:
    - name: senior-security-reviewer
      agenthubId: acme/senior-security-reviewer
      assignedByAgentLink: true
      assignedAt: "2026-03-04T11:00:00Z"
```

`agentlink-assigned` personas have the **highest precedence** — they override any
locally installed version of the same name (but cannot override built-in roles).

---

## Loading Precedence

When multiple sources define a persona with the same name, the highest-precedence
source wins:

| Priority    | Source              | Location                                       |
| ----------- | ------------------- | ---------------------------------------------- |
| 5 (highest) | `agentlink-assigned` | pushed from builderforce.ai portal             |
| 4           | `agenthub`           | `~/.builderforce/personas/` (marketplace install) |
| 3           | `project-local`     | `.builderforce/personas/*.yaml`                   |
| 2           | `user-global`       | `~/.builderforce/personas/*.yaml`                 |
| 1 (lowest)  | `builtin`           | shipped in BuilderForce Agents core                      |

Built-in roles (`code-creator`, `code-reviewer`, etc.) cannot be overridden —
marketplace personas can only add new names.

---

## Built-in Roles Reference

| Role                   | Voice                          | Decision Style                                              | Output Prefix |
| ---------------------- | ------------------------------ | ----------------------------------------------------------- | ------------- |
| `code-creator`         | pragmatic and quality-driven   | ship it, but ship it right                                  | `CODE:`       |
| `code-reviewer`        | critical yet constructive      | thorough: all issues, ranked by severity                    | `REVIEW:`     |
| `test-generator`       | systematic and exhaustive      | coverage-first: edge cases before happy paths               | `TESTS:`      |
| `bug-analyzer`         | investigative and precise      | evidence-driven: hypothesis → test → verify                 | `BUG-FIX:`    |
| `refactor-agent`       | disciplined and incremental    | safe: one refactor at a time, tests green first             | `REFACTOR:`   |
| `documentation-agent`  | clear, concise, audience-aware | reader-first: if a newcomer can't understand it, rewrite it | `DOCS:`       |
| `architecture-advisor` | strategic and pragmatic        | trade-off oriented: always show the cost of each option     | `ARCH:`       |
