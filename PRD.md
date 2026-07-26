> **PRD** — drafted by CTO · task #502
> _Each agent that updates this PRD signs its change below._

# PRD: Project Health Assessment - Canonical Question Set v1.0.0

## Problem & Goal
Project health reviews lack standardization, leading to inconsistent data collection, missed escalations, and poor cross-project visibility.  
Goal: Deliver a portable, versioned canonical question set that standardizes assessment across eight dimensions, enforces escalation rules, and produces reliable GREEN/AMBER/RED health scores.

## Target Users / ICP Roles
- Project managers and delivery leads  
- Engineering managers and team leads  
- Program managers and PMO staff  
- Executives requiring portfolio-level health snapshots

## Scope
- Define 8 assessment dimensions with primary, probe, and escalation-trigger questions  
- Specify supported response formats and scoring logic  
- Produce a single tool-agnostic artifact (QUESTION_SET_CANONICAL.md) portable to Markdown, Google Docs, Confluence, and Notion  
- Version the artifact as v1.0.0

## Functional Requirements
- Cover exactly these dimensions: timeline status, business deadlines, customer deadlines, budget status, team capacity, quality concerns, risk factors, stakeholder alignment  
- Each dimension contains ≥1 primary question, ≥2 probe questions, and 1 escalation-trigger question  
- Support response formats: numeric, free-text, date, yes/no, status-rating  
- Implement escalation aggregation: ≥3 triggers in one dimension → RED for that dimension  
- Compute overall project health score (GREEN/AMBER/RED) from dimension results  
- Remain fully document-based with no external dependencies

## Acceptance Criteria
- All 8 dimensions are fully populated with required question types  
- Escalation rule and overall scoring logic are explicitly documented and deterministic  
- Document renders cleanly in Markdown, Google Docs, Confluence, and Notion  
- Version header reads v1.0.0 and file name matches QUESTION_SET_CANONICAL.md  
- No tool-specific formatting or proprietary syntax is present

## Out of Scope
- Automated tooling, dashboards, or integrations  
- Historical trending or analytics features  
- Custom question authoring UI or configuration system  
- Training materials or rollout process

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