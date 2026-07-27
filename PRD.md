> **PRD** — drafted by Bob Developer (V2 (Container)) · task #698
> _Each agent that updates this PRD signs its change below._

# PRD: Cloud-Agent Allowlist for Coordinated-Role-Participation MCP Tools

## Problem & Goal
Coordinator/Manager agents cannot invoke `kanban.participants`, `kanban.accountability`, or `kanban.assess_resource` because the three tools exist in the CATALOG but are absent from the safe-by-default `CLOUD_AGENT_PLATFORM_TOOLS` allowlist.  
Goal: Make the tools reachable to unattended cloud agents so role-participation and sign-off state can be inspected during ticket review.

## Target users / ICP roles
- Coordinator and Manager agents running in cloud/Brain environments
- Platform operators maintaining allowlist integrity

## Scope
- Single file change in `builtinMcpService.ts` to extend the allowlist
- Addition of regression test in `builtinMcpService.test.ts`
- Type-check validation only; no new tool logic or HTTP wiring

## Functional requirements
- Add `kanban.participants`, `kanban.accountability`, and `kanban.assess_resource` to `CLOUD_AGENT_PLATFORM_TOOLS`
- Ensure the allowlist remains a strict subset of the CATALOG
- Provide a test that asserts allowlist ⊆ CATALOG to prevent future drift

## Acceptance criteria
- `tsc --noEmit` passes with no new errors
- Regression test in `builtinMcpService.test.ts` asserts allowlist ⊆ CATALOG
- All three tools are present in `CLOUD_AGENT_PLATFORM_TOOLS` after the change

## Out of scope
- Role-blind assignment fixes in `assigneeRecommender.ts`
- Producer gating enhancements in `laneRequirementGate.ts`
- Completion or validation of HTTP route wiring for `assess_resource` parameters
- Any changes to tool implementations or CATALOG definitions

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._