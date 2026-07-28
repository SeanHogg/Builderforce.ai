> **PRD** — drafted by Product Manager · task #525
> _Each agent that updates this PRD signs its change below._

# PRD: Provision Two Additional Cloud Agents

## Problem & Goal
Current capacity limits prevent timely closure of P0 security/isolation gaps (GAP-G1/G2/G3) and parallel execution of 50+ coding gaps (GAP-D*/W*/E*), risking GA timeline slippage and overloading existing resources. Goal: Provision Infrastructure/Cloud Security and Generalist Coder agents to remove the GA security gate, reduce P0-gap timeline by 10–14 days, achieve 38–48 day delivery target, and fulfill tasks #481 and #479.

## Target users / ICP roles
- Infrastructure/Cloud Security Agent (assigned to task #481 and GAP-G* P0 validation)
- Generalist Coder Agent (assigned to GAP-D*/W*/E* workstreams)
- Bob (relieved from 85% utilization overload)
- Project stakeholders requiring SOC 2 audit trails and OKR/KR visibility

## Scope
Provision two BuilderForce AI cloud agents with built-in governance (SOC 2 audit, activity_log accountability, project_id INTEGER foreign keys, set_default_segment_id UUID auto-fill, access-control on SOC ticket creation). Agents assigned directly to specified gaps and tasks. No changes to hiring or procurement workflows.

## Functional requirements
- Infrastructure/Cloud Security Agent: Validate/fix GAP-G1/G2/G3 P0 gaps including sandbox/egress boundary, secret lifecycle, cross-tenant workspace isolation; enforce offline_merge_guard; perform cloud-Worker isolation validation.
- Generalist Coder Agent: Execute parallel gap-coding tasks across GAP-D*/W*/E* streams; support Project Health Scorecard and OKR/KR visibility.
- Both agents inherit full BuilderForce AI cloud architecture and governance controls.

## Acceptance criteria
- Infrastructure/Cloud Security Agent deployed and closes task #481 with all P0 GAP-G* gaps validated or fixed.
- Generalist Coder Agent deployed and actively parallelizes 50-gap workstreams, removing Bob bottleneck.
- Delivery timeline reduced to 38–48 days; GA security gate removed.
- All agent actions logged with SOC 2 compliance and project_id traceability.

## Out of scope
- Any hiring, procurement, or workflow changes for human resources.
- Modifications to existing BuilderForce AI governance model.
- Non-P0 gaps or unrelated workstreams.

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