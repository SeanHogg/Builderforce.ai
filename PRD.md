> **PRD** — drafted by Ada (Sr. Product Mgr) · task #769
> _Each agent that updates this PRD signs its change below._

# Epic Assignee → Manifest Owner Auto-Update

## Problem & Goal
Manifests that represent epics must reflect the current epic owner. Today, when an epic’s assignee changes, the manifest’s `Owner` field is not automatically updated. Teams must manually recreate the epic or edit the manifest, which is error‑prone, delays delivery visibility, and introduces inconsistency.  
**Goal:** Automatically propagate epic assignee changes to the linked manifest’s `Owner` field in near‑real time, without recreating the epic or requiring manual intervention.

## Target Users / ICP Roles
- **Primary:** Release Train Engineers, DevOps engineers, and Scrum Masters who maintain manifest artifacts tied to epics.
- **Secondary:** Product Managers and Epic Owners who need accurate ownership metadata in downstream automation.

## Scope
- Detect assignee changes on an epic in the tracking system.
- Identify the manifest associated with that epic via an existing link (e.g., epic key, custom field, or predefined mapping).
- Update only the `Owner` field of the manifest.
- Operate automatically; no manual workflow or epic recreation.
- Support both assignment and unassignment events.
- Provide per‑project enable/disable configuration.

## Functional Requirements
1. **Event Detection**  
   The system listens to “assignee changed” events for epics within configured projects.

2. **Manifest Association**  
   When an event is received, the system resolves the corresponding manifest using the epic’s identifier (e.g., Jira issue key).  
   - If no manifest is associated, the event is discarded (no error).

3. **Owner Update**  
   - On assignment: set `Owner` to the new assignee’s canonical identifier (e.g., username, email, or as configured per project).  
   - On unassignment: set `Owner` to a configurable placeholder (default: “Unassigned”) or leave empty per project settings.

4. **Timeliness**  
   The manifest update must complete within **60 seconds** of the assignee change event being published.

5. **Audit Logging**  
   Each update logs: epic key, old assignee, new assignee, manifest identifier, timestamp, and whether the update succeeded.

6. **Epic Preservation**  
   The epic itself is not modified beyond the assignee change. Its key, ID, history, and metadata are unchanged—no new issue creation or recreation occurs.

7. **Configuration**  
   - Boolean project‑level flag to enable/disable the auto‑update.  
   - Configurable placeholder for unassigned owner.  
   - Configuration may be stored in project settings or manifest‑specific metadata.

## Acceptance Criteria
1. **Happy Path:**  
   Given an epic with assignee `UserA` and an associated manifest where `Owner = UserA`,  
   when the assignee is changed to `UserB`,  
   then within 60 seconds the manifest `Owner` is updated to `UserB` without any manual action and the epic’s attributes (key, ID, etc.) remain unaltered.

2. **Unassignment:**  
   Given an assignee is set to “none” (unassigned),  
   then the manifest `Owner` is set to the configured placeholder (e.g., “Unassigned”) or removed, according to project configuration.

3. **Audit Trail:**  
   The system logs the old assignee, new assignee, manifest ID, and a timestamp for each triggered update.

4. **No Epic Recreation:**  
   Verify that the epic’s issue history shows only the assignee change; no new issue creation, no change of key or summary, and no side‑effects that resemble a recreation.

5. **Toggle Off:**  
   When the feature is disabled at the project level, a change to an epic’s assignee does **not** cause any manifest update.

## Out of Scope
- Automatic creation of a manifest from an epic; only existing associations are handled.
- Updating any manifest field other than `Owner` (e.g., title, description, status).
- Bi‑directional sync (updating the epic when the manifest’s Owner changes).
- Bulk assignee operations where multiple epics are changed in a single transaction; behavior is undefined.
- Migration or backfill of historical assignee changes.
- A UI for manually triggering the sync or viewing the configuration beyond project settings.

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