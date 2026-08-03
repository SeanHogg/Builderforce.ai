> **PRD** — drafted by Ada (Sr. Product Mgr) · task #550
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: PRD.md Content Correction

## Problem & Goal
The file `PRD.md` in the current branch erroneously contains the Product Requirements Document for **task #157 (Diagnostic Report)**, including sections for Timeline, Budget, Quality, Risk, Team, Alignment, a health score 0–100, and PDF export. The file’s change history indicates it was originally created by Ada for **task #146 (Cross-Project Health Dashboard)**, but the correct content was overwritten. This discrepancy misleads stakeholders and developers who rely on `PRD.md` as the authoritative source for the Cross-Project Health Dashboard requirements.  
**Goal:** Restore the accurate PRD content for task #146 by replacing the current file content with the original PRD body from task #146 (containing FR-1 through FR-6, RAG rules, 5-project analysis, and other relevant details).

## Target Users / ICP Roles
- **Developers & QA** reading `PRD.md` to understand Cross-Project Health Dashboard functionality.  
- **BA/PM/PO** referencing the document for scope and acceptance criteria.  
- **Stakeholders** verifying alignment between the PRD and the intended dashboard features.

## Scope
- Modify only the `PRD.md` file in the current branch to contain the correct PRD for **task #146 (Cross-Project Health Dashboard)**.  
- The correction will be delivered as a single commit that completely overwrites the erroneous content with the original task #146 PRD body (as stored in the task management system).  
- No other files, branches, or project artifacts will be altered.

## Functional Requirements
- **FR-1:** After correction, `PRD.md` MUST include the task #146 header and sections identical to the original PRD body, including:
  - Title referencing “Cross-Project Health Dashboard”
  - Functional requirements FR-1 through FR-6 (detailed analysis of 5 projects, RAG status rules, etc.)
  - Any supporting diagrams, assumptions, or constraints present in the original task #146 PRD.
- **FR-2:** No content from task #157 (Diagnostic Report) – such as “Timeline”, “Budget”, “Quality”, “Risk”, “Team”, “Alignment”, “Health Score”, “What’s Overdue”, or PDF export details – shall remain in `PRD.md`.
- **FR-3:** The correction commit message must clearly state: **“Restore task #146 Cross-Project Health Dashboard PRD; overwrite erroneous task #157 content”** (or an equivalent unambiguous message).

## Acceptance Criteria
- **AC1:** The content of `PRD.md` exactly matches the original task #146 PRD body, byte-for-byte (excluding any auto-generated line-ending differences that do not alter the rendered document).
- **AC2:** A full-text search confirms zero occurrences of task-specific keywords from the Diagnostic Report PRD (e.g., “Diagnostic Report”, “health score 0-100”, “PDF export”).
- **AC3:** The branch history shows the correction as the latest commit with the specified message, and the previous inaccurate version is still accessible as the parent commit.

## Out of Scope
- Creating, updating, or removing any other documentation (including task #157’s PRD in its correct location).
- Changing branch naming, merging strategy, or repository configuration.
- Validating the technical correctness of the restored task #146 PRD content; the source of truth is the task management record.
- Adding new features or revising the Cross-Project Health Dashboard requirements beyond restoring the original.

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