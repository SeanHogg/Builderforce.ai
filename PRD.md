> **PRD** — drafted by Ada (Sr. Product Mgr) · task #774
> _Each agent that updates this PRD signs its change below._

# PRD: Persistent Assignment on Manifest Re‑read  
**Status:** WIP  

## Problem & Goal  

Users create tasks by importing a declarative *manifest* (YAML, JSON, etc.). After import, they refine those tasks—particularly by setting **assignees** that reflect real‑world ownership. When the manifest is later re‑read (e.g. to pull in upstream changes, re‑sync, or apply an update), the system currently discards those manual assignments, reverting each task to its manifest‑specified or default owner. This causes repeated, error‑prone re‑work and discourages the use of assignee overrides.  

**Goal:** Ensure that once a human‑set assignment is applied to a task derived from a manifest, that assignment survives any subsequent manifest re‑read, as long as the task itself remains present and identifiable.  

## Target Users / ICP Roles  

- **Project Lead / Engineering Manager** – Defines task structure in a manifest but needs to delegate ownership to individuals after import.  
- **Team Lead / Scrum Master** – Uses manifests for bulk task creation from templates, then fine‑tunes assignments for the sprint.  
- **Individual Contributor** – Occasionally overrides their own tasks’ assignment when the manifest’s default doesn’t fit.  

## Scope  

**In scope**  
- Preserving the `assignee` field (and any associated assignment metadata) across re‑imports of the same manifest.  
- Stable, idempotent matching of tasks from the manifest to the stored tasks (using a unique identifier embedded in the manifest).  
- Handling a re‑read that modifies a task’s content (description, title, etc.) while preserving the user‑set assignment.  
- Clear communication to the user when a task that had an override is removed from the manifest (e.g. via status change or UI notification).  

**Out of scope**  
- Updating or merging assignments when the manifest’s own `assignee` field changes (the override always wins).  
- Automatic re‑assignment of orphaned assignments to new tasks.  
- Full versioning or audit trail of assignment changes.  
- Handling manifests that lack a reliable, stable task identifier (fallback behaviour, if any, is deployment‑specific).  
- UI for bulk‑resetting assignments to manifest defaults.  

## Functional Requirements  

1. **Task Identity**  
   - Each task defined in a manifest MUST include a stable, unique `id` field.  
   - The system MUST use this `id` as the primary key for matching manifest entries to stored tasks.  

2. **Assignment Persistence**  
   - When a manifest is re‑read, for each task that already exists in the system (matched by `id`):  
     - If the stored task has a non‑default `assignee` (i.e. a user manually set it), the system MUST retain that `assignee`.  
     - All other fields (title, description, custom fields, etc.) MAY be updated to reflect the latest manifest content.  

3. **Addition & Removal**  
   - New tasks appearing in the manifest for the first time SHALL be created with the manifest‑specified `assignee` (or default).  
   - If a task previously existed (and had an assignment) but is no longer present in the manifest, the system SHALL:  
     - Preserve the task;  
     - Clear or flag the assignment as “orphaned” (no longer backed by manifest), or optionally convert it to a manually‑created task;  
     - Notify the user/administrator of the change.  

4. **User Experience**  
   - During a re‑read, the system SHALL log retained assignments in an outcome summary (e.g. “12 assignments preserved”).  
   - When an orphaned assignment occurs, the UI MUST indicate that the task is no longer managed by the manifest.  

## Acceptance Criteria  

1. **Basic persistence**  
   - Given a manifest defines `Task-A` with no assignee, and a user later sets `assignee: alice`,  
     when the manifest is re‑read with the identical `Task-A`,  
     then `assignee` remains `alice`.  

2. **Manifest update without overwrite**  
   - Given `Task-A` has `assignee: alice`,  
     when the manifest is re‑read after editing `Task-A.description`,  
     then `description` updates to the new value **and** `assignee` remains `alice`.  

3. **New manifest field ignored**  
   - Given a task that previously had no `assignee` in the manifest and the user assigned `bob`,  
     when the manifest is updated to set `assignee: charlie` on the same task ID,  
     then the stored assignee remains `bob` (the manual override wins).  

4. **Task removal**  
   - Given `Task-B` exists with `assignee: dave`,  
     when the manifest is re‑read and `Task-B` is no longer present,  
     then the task is preserved, its assignment is flagged as orphaned, and a summary event reports the removal.  

5. **Performance**  
   - Re‑reading a manifest of up to 10,000 tasks shall complete assignment preservation in less than 5 seconds under normal load.  

## Out of Scope  

- Any automatic conflict resolution beyond “override‑always‑wins” (e.g. merging partial assignments).  
- Historical tracking of who changed an assignment or when.  
- Handling of manifests that do not include stable task identifiers (such systems may lose assignments).  
- Bulk “revert to manifest” capability.  
- Support for assignment patterns like round‑robin or load‑based suggestions during re‑read.

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