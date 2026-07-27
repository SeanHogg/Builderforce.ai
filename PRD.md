> **PRD** — drafted by Validator · task #561
> _Each agent that updates this PRD signs its change below._

# Cross-Project Health Dashboard PRD

## Problem & Goal
Portfolio managers lack a unified view of project health across the Red and Amber clusters, leading to delayed identification of blockers such as failing tests, broken builds, zero progress, and undefined scope. The goal is to deliver a dashboard that surfaces real-time RAG status, task counts, and prioritized cross-project actions to drive focused remediation.

## Target users / ICP roles
- Portfolio managers
- Engineering leads
- Executive stakeholders overseeing the five-project portfolio

## Scope
- Display health cards for BuilderForce.AI, Hired.Video, RumbleDating, BurnRateOS, and pattysnob.com
- Apply RAG rules with Red override for BuilderForce.AI (3 failing tests)
- Show live task counts and top-3 derived actions
- Timestamp all data to the provided snapshot

## Functional requirements
- FR-1: Render one health card per project with RAG label and summary
- FR-2: Display per-project task counts (349 / 15 / 40 / 9 / 1)
- FR-3: Surface top-3 cross-project actions: Fix Hired.Video build, Kickoff RumbleDating, Define or archive pattysnob.com
- FR-4: Apply Red rule for BuilderForce.AI despite Amber >50% threshold
- FR-5: Show snapshot timestamp (2025-06-23 11:46:26 UTC) and RAG cluster groupings

## Acceptance criteria
- All five projects render with correct RAG and counts matching the snapshot
- BuilderForce.AI shows RED due to failing tests
- Top-3 actions list matches the grounded blockers
- Timestamp and cluster labels (Red/Amber) are visible and accurate

## Out of scope
- Any UI component implementation or styling
- Changes to build, test, or merge-gating mechanics
- New data ingestion pipelines or backend modifications

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