> **PRD** — drafted by Ada (Sr. Product Mgr) · task #501
> _Each agent that updates this PRD signs its change below._

# Backlog Burn-Rate Estimator PRD

## Problem & Goal
Teams lack a reliable, pure-function method to forecast effort (agent-hours and human-hours) required to clear remaining backlog based on observed velocity. This PRD delivers a deterministic calculation engine with confidence intervals, sensitivity analysis, deadline break-even velocity, dual-track comparison, blocked-hours risk, WIP flags, and calendar projection to improve sprint planning accuracy and risk visibility.

## Target users / ICP roles
- Engineering managers and tech leads
- Product owners managing backlog velocity
- Delivery and program managers tracking agent vs human throughput

## Scope
- New pure module `api/src/application/insights/backlogBurnRate.ts` implementing the estimation engine
- Comprehensive test suite `api/src/application/insights/backlogBurnRate.test.ts` (vitest) covering all acceptance criteria and edge cases
- Covers FR-1..FR-6 and AC-1..AC-8
- Markdown and JSON output formats only

## Functional requirements
- FR-1: Compute agent-hours and human-hours to clear remaining backlog from observed velocity
- FR-2: Provide confidence intervals on estimates
- FR-3: Perform sensitivity analysis at ±10% and ±25% velocity variance
- FR-4: Calculate break-even velocity required to meet a given deadline
- FR-5: Support dual-track comparison (agent vs human) with blocked-hours-at-risk and WIP risk flags
- FR-6: Project calendar completion date and emit results in both markdown and JSON

## Acceptance criteria
- AC-1: Engine is pure (no side effects, deterministic output for identical inputs)
- AC-2: Returns numeric estimates for agent-hours and human-hours
- AC-3: Includes 95% confidence interval bounds
- AC-4: Sensitivity results generated for both ±10% and ±25% scenarios
- AC-5: Break-even velocity computed correctly against supplied deadline
- AC-6: Dual-track output distinguishes agent vs human paths and flags blocked hours and WIP risk
- AC-7: Calendar completion date calculated from velocity and backlog size
- AC-8: Both markdown and JSON renderers produce valid, complete output matching internal data model

## Out of scope
- UI components or dashboard integration
- Persistence, API endpoints, or external data sources
- Real-time streaming or live metric collection
- Historical data import or velocity trend analysis

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