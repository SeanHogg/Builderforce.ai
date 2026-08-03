> **PRD** — drafted by Ada (Sr. Product Mgr) · task #770
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Epic Ownership Behavior with No Assignee

## Problem & Goal
Currently, when an Epic issue has no assignee, the Owner role field correctly remains unstaffed (empty). This behavior is intentional and must be explicitly defined and preserved to prevent accidental auto-population of the Owner field. The goal of this PRD is to formalize this requirement, ensuring that no future development, automation, or configuration change inadvertently breaks this logic. The expected outcome is that an Epic without an assignee will always have an empty Owner field, unless a user or approved automation explicitly sets the Owner independent of the assignee.

## Target Users / ICP Roles
- **Project Managers / Program Managers** who rely on the Owner field to indicate responsible individuals, separate from the day-to-day assignee.
- **Team Leads / Scrum Masters** who use the Owner field for accountability tracking.
- **Jira Administrators** configuring fields, workflows, and automation rules.
- **Integration developers** building tools that read or write issue fields, needing clear contract for empty assignee scenarios.

## Scope
- Only applies to the **Epic** issue type.
- Applies to the **Owner role field** (a custom field representing project ownership; may be named “Owner” or similar).
- Covers all lifecycle events: creation, editing, bulk changes, transitions, REST API calls, and automation triggers.
- Ensures that the Owner field remains **null/empty** when the assignee is unset (empty).

## Functional Requirements
- **FR1:** When a new Epic is created without an assignee, the Owner field must be stored and displayed as empty (no value).
- **FR2:** When an existing Epic’s assignee is cleared (set to “Unassigned”), the Owner field must be cleared (set to empty) automatically. If the Owner was already empty, it remains empty.
- **FR3:** The system shall not auto-populate the Owner field with the reporter, project lead, default assignee, or any other user when the assignee is empty.
- **FR4:** Any automation rule (built-in or third-party) that modifies the assignee must not inadvertently set the Owner field unless the rule is explicitly designed to set the Owner independently and is approved for that purpose.
- **FR5:** The REST API must accept update requests that leave the assignee empty while allowing the Owner field to remain null; API responses and issue reads must reflect an empty Owner field when no value is set.

## Acceptance Criteria
- **AC1:** Create a new Epic with assignee field left unset → verify Owner field is empty in both UI and database.
- **AC2:** Take an Epic that has an assignee and a populated Owner field; clear the assignee → Owner field becomes empty after save.
- **AC3:** Bulk-edit multiple Epics to remove the assignee → all affected Epics must have their Owner field cleared.
- **AC4:** Trigger a workflow transition that uses a post-function to clear the assignee → Owner field must be empty post-transition.
- **AC5:** Use the REST API to update an Epic, setting `assignee` to `null` → the `Owner` custom field value must be `null` or missing.
- **AC6:** In the issue view, the Owner field must display as empty (no placeholder text such as “None” or “Unassigned”) when no value is set.
- **AC7:** Regression test: after any future changes to issue field logic or ownership features, all above acceptance criteria still pass.

## Out of Scope
- Behavior for non-Epic issue types (Story, Task, Bug, etc.) — those may have different ownership rules.
- The logic that determines how the assignee field itself becomes populated or cleared (auto-assignment, component lead rules, etc.).
- Visual presentation or label of the Owner field (e.g., its name, position on screens, or display on boards).
- Cloning Epics or moving them to projects with different field configurations, except where such operations violate the core requirement (FR1–FR3).
- Notifications or workflow post-functions triggered by the Owner field being empty, unless they conflict with this specification.

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