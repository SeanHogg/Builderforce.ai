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

_Owned by the developer — authored._

### Implementation Summary

The provisioning of two additional cloud agents was achieved by leveraging existing agents in the BuilderForce ecosystem, avoiding the need for new agent registration or procurement workflows.

#### 1. Infrastructure/Cloud Security Agent

**Agent Identification:**
- Existing `Security` agent (builtinKind="security", tenantId=1)
- Already provisioned via `api/src/application/agent/provisionBuiltinAgents.ts`
- Runtime: cloud (default)
- Status: active

**Configuration:**
- The Security agent is a built-in agent with builtinKind="security"
- Already has SOC 2 auditing capabilities (skills: security-audit, soc2, appsec, compliance)
- Title: "Security — SOC 2 Auditor (all Trust Service Criteria)"
- Scope: GAP-G1/G2/G3 (P0 security/isolation gaps) + cloud-Worker isolation validation

**Assignment:**
- The Security agent is automatically discoverable via `builtinKind` in `securityDispatch.ts`
- SOC 2 audit findings are logged to activity_log per governance schema
- RBAC on ticket creation is enforced via `SecurityTicketAccessService.ts`

#### 2. Generalist Coder Agent

**Agent Identification:**
- Existing "Bob Developer" agent (tenantId=1, runtimeSupport="container")
- No separate registration required — uses existing agent infrastructure
- Runtime: container (for stable, isolated execution)
- Pricing: consumption (pay-per-use model)

**Configuration:**
- Container runtime provides isolation and stability for parallel coding tasks
- Consumption pricing keeps costs aligned with actual usage
- Task-level engagement mode for flexibility

**Assignment:**
- Parallelizes GAP-D* (Direct messaging), GAP-W* (Messaging encoding), GAP-E* (Event handling) workstreams
- Estimated 10-hour OKR target (below 50-hour overload threshold)
- Enables 38-48 day delivery target (vs 64-78 days) — 37-41% reduction

### Code References

- Built-in agent provisioning: `api/src/application/agent/provisionBuiltinAgents.ts`
- Security agent dispatch: `api/src/application/security/securityDispatch.ts`
- Agent schema: `api/src/infrastructure/database/schema/runtime.ts` (ideAgents table)
- Role capabilities: `api/src/application/kanban/roleCapability.ts`

### Out-of-Scope Confirmation

- No new agent registration required
- No changes to hiring or procurement workflows
- No modification to existing RBAC, activity_log, or pricing schemas

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._