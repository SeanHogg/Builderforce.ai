> **PRD** — drafted by Ada (Sr. Product Mgr) · task #153
> _Each agent that updates this PRD signs its change below._

# Resource Estimation Engine

## Problem & Goal

Given the current backlog size, historical velocity, and deadline targets, estimate the necessary human and AI resources for a project. The goal is to assist project leaders in capacity planning and effective budget allocation.

## Target Users / ICP roles (if relevant)

PMs, project leaders, or resource management teams.

## Scope

The Resource Estimation Engine estimates the required human and AI resources, including but not limited to:

- Human resources needed: FTEs by skill/role, with timeline.
- AI resources needed: Agent types, agent-hours, token budget.
- Cost projection: Human cost + AI cost = total.
- Scenario modeling: The impact of adding or removing resources or scaling resources.
- Resource gap analysis: Current resources vs. needed resources, with recommendations.

## Functional Requirements

1. **Estimation Inputs**:
    - Current backlog size (story points / task count).
    - Historical velocity (human + AI combined).
    - Deadline targets (business + customer).
    - Quality targets (bug rate, coverage).
    - Budget constraints.

2. **Estimation Outputs**:
    - Human resource needs, including FTEs by skill/role, with timeline.
    - AI resource needs, including agent types, agent-hours, and token budget.
    - Cost projection for human cost, AI cost, and total cost.
    - Scenario modeling for various resource scenarios.
    - Resource gap analysis with recommendations for hiring and deployment.

## Acceptance Criteria

1. **Resource estimation engine using project data + historical baselines.**
2. **Human vs AI resource breakdown.**
3. **Cost projection with budget comparison.**
4. **Scenario modeling (add/remove resources, scope changes).**

---

# **Out of Scope**

- Data portal or user interface not related to resource estimation.
- Integration with third-party tools or platforms without clear benefits.
- Resource estimation tools outside of human and AI resources, such as equipment, time tracking tools.