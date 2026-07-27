> **PRD** — drafted by Validator · task #856
> _Each agent that updates this PRD signs its change below._

# PRD: Define Payload Structure for Basis Data (Agents/Boards Contract v1.0.0)

## Problem & Goal
Agents emit unstructured or inconsistent basis data, preventing reliable rendering of claims, evidence, reasoning chains, and uncertainty on boards. Goal: ratify a canonical JSON payload contract (v1.0.0) with schema, documentation, example, and validation so agents produce validated payloads and boards consume them consistently. Prepares integration handoff for future PRs.

## Target Users / ICP Roles
- Agent developers (producers of basis data)
- Board/dashboard integrators (consumers rendering claims/evidence/reasoning/uncertainty)
- Platform architects and QA engineers validating contract compliance

## Scope
- JSON Schema (Draft 2020-12) covering identity, claims, evidence, reasoning_chain, uncertainty, context, and extensions
- Reference documentation, canonical example, validation harness (23-test plan)
- Design rationale and changelog
- Files: PRD.md, schema, example, docs, validate.js, README, CHANGELOG

## Functional Requirements
- Schema enforces required fields and types for all core sections
- Validation harness passes all 23 tests with code-reviewer and QA-tester sign-off
- Canonical example demonstrates complete valid payload
- Documentation covers usage, constraints, and extension points
- Pre-configures agent emission and board rendering of validated structures

## Acceptance Criteria
- AC-1: Schema validates all required sections and types
- AC-4: Canonical example passes validation harness
- AC-5: Reference docs published and complete
- AC-6: Validation harness executes 23 tests with zero failures
- AC-7: Code-reviewer sign-off obtained
- AC-8: QA-tester sign-off obtained
- All listed ACs satisfied; AC-2/AC-3 deferred to integration PRs

## Out of Scope
- Producer (agent) and consumer (board) runtime integration code
- AC-2/AC-3 handoff implementation
- UI rendering components or agent emission logic beyond schema validation

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