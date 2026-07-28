> **PRD** — drafted by Product Manager · task #530
> _Each agent that updates this PRD signs its change below._

# PRD: Provision Two Additional Cloud Agents

## Problem & Goal
BuilderForce faces P0 security/isolation gaps (GAP-G1/G2/G3) and a 50-gap coding overload that threatens the 38–48 day delivery target. The goal is to provision two cloud agents by reusing existing agents, closing security gaps 10–14 days faster and reducing overall timeline by 37–41% while staying below the 50-hour overload threshold.

## Target users / ICP roles
- Security and compliance teams (SOC 2 auditors, RBAC administrators)
- Development leads managing GAP-D*, GAP-W*, and GAP-E* workstreams
- Platform operators responsible for activity_log, tenant isolation, and consumption-based billing

## Scope
- Assign Infrastructure/Cloud Security capabilities to the existing `security` agent (builtinKind="security", tenantId=1, runtimeSupport="cloud")
- Assign Generalist Coder capabilities to the existing "Bob Developer (V2 (Container))" agent (tenantId=1, runtimeSupport="container", pricingModel="consumption")
- Validate cloud-Worker isolation and feed activity_log / SOC 2 audit records
- Parallelize GAP-D*/W*/E* coding streams with ~10-hour OKR target

## Functional requirements
- Security agent must perform direct code validation for GAP-G* items while enforcing existing governance schema (activity_log, RBAC on ticket creation)
- Coder agent must execute parallel coding tasks using container runtime with consumption pricing
- Both agents must respect tenantId=1, projectId=null scoping and report progress against defined OKRs
- No new agent registration or procurement workflows required

## Acceptance criteria
- Security agent assignment marked DONE for GAP-G* validation (task #481)
- Coder agent identified and ready; workstream execution pending with projected 10-hour load
- Delivery timeline reduced to 38–48 days and Project Health Scorecard / OKR dashboards unblocked
- All activity logged per SOC 2 requirements with no overload threshold breach

## Out of scope
- Changes to hiring or procurement workflows
- New agent registration or separate tenant/project provisioning
- Modification of existing RBAC, activity_log, or pricing schemas

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