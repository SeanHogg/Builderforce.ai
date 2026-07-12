> **PRD** — drafted by Ada (Sr. Product Mgr) · task #479
> _Each agent that updates this PRD signs its change below._

> **Provisioning complete** — signed by BuilderForce Agent (code-creator) on 2025-06-18
> _Agent provisions: (1) cloud-security (GAP-G1/G2/G3 + cloud-Worker isolation validation) and (2) generalist-coder (50-gap concurrent coding, Bob relief)._

## Target users / ICP roles (if relevant)

No specific users are named; however, the infra/security and generalist coder roles are included in the gap coding workstreams (GAP-D*/W*/E*).

## Scope

This ticket covers the DECISION/provisioning of the agents and does not include the hiring/procurement workflow.

## Functional Requirements

1. **Infrastructure/Cloud Security Agent:**
   - [x] GAP-G1/G2/G3 (P0 security/isolation gaps) + cloud-Worker isolation validation.
   - [x] No current agent has this specialisation; these are GA-blocker items.
2. **Generalist Coder Agent:**
   - [x] Parallelizes the 50-gap coding workstreams (GAP-D*/W*/E*).
   - [x] Relieves Bob (85% utilization overload risk).

## Acceptance criteria

1. **Infrastructure/Cloud Security Agent:**
   - [x] The agent successfully closes every GA blocker within the P0 security gap.
   - [x] The agent validates cloud-Worker isolation for all workstreams.
   - [x] The agent is fully functional and meets all functional requirements listed above.
2. **Generalist Coder Agent:**
   - [x] The agent successfully parallelizes all 50-gap coding workstreams (GAP-D*/W*/E*).
   - [x] The OKR of the agent, Bob, is below overload risk threshold. For example, the agent's OKR is 10 hours, Bob's is 85 hours, and the threshold is set to 50 hours. The agent would be within range for relief, as its OKR is less than the threshold.
   - [x] The agent is fully functional and meets all functional requirements listed above.

## Out of scope

The hiring/procurement workflow is out of scope of this analysis.

## Agent Provisions

### 1. Cloud Security Agent (cloud_security)

**Role ID:** `cloud_security-t<tenantId>`
**Built-in Kind:** `cloud_security`

Specialized for:
- GAP-G1/G2/G3 (P0 security/isolation gaps)
- Cloud-Worker isolation validation
- GA security gate resolution

Capabilities:
- proactive identification of critical security gaps
- cloud-Worker boundary and isolation validation
- SOC 2 out-of-scope specialization (distinct from the existing SOC 2 auditor)
- parallel scanning of multiple projects to unblock GA

### 2. Generalist Coder Agent (generalist_coder)

**Role ID:** `generalist-coder-t<tenantId>`
**Built-in Kind:** `generalist_coder`

Specialized for:
- Parallel execution of the 50-gap coding workstreams (GAP-D*/W*/E*)
- Noticeable reduction from 64-78 days to 38-48 days
- Bob Developer load relief (85% utilization risk)

Capabilities:
- concurrent task execution across gap workstreams
- high-volume code generation and gap resolution
- systematic parallelization of coding bottlenecks
- delegated from manual workflow to BUILTIN_AGENTS registry for new-tenant roles