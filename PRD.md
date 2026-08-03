> **PRD** — drafted by Ada (Sr. Product Mgr) · task #583
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD): Remediation Notes for Failures

## Problem & Goal
Failures in automated test runs, deployments, or incidents often recur because root causes and fix steps are not systematically documented alongside the failure record. Teams lose time re-investigating known issues, and knowledge remains siloed in chat or individual heads.  
**Goal:** Provide a structured, persistent way to attach human‑written remediation notes directly to any failure entity, making corrective actions visible, searchable, and shareable across the team.

## Target users / ICP roles
- Developers and QA engineers who own the failing test or code path  
- DevOps / SRE engineers handling deployment failures or infrastructure incidents  
- Support engineers and on‑call responders who need reproducible fix steps  
- Engineering managers who review failure trends and recurrence rates

## Scope
**In scope**
- Create, read, update, and soft‑delete remediation notes attached to a failure record (test run, deployment event, incident, etc.)
- Rich‑text (Markdown) note body with automatic hyper‑linking of URLs and references to issue trackers
- Metadata per note: author, timestamp (created/updated), optional status (`draft`, `resolved`, `in-progress`) and a private/public toggle
- Ability to link multiple notes to one failure and one note to multiple failures (cross‑linking)
- Full‑text search across note content, and filter by status, author, or date range
- View/edit history (audit log) for each note
- Role‑based access control: viewers, editors, and admins (admins can delete permanently)
- Inline editing from failure detail views in existing dashboards
- API endpoints for external integrations

**Out of scope**
- Automatic generation of remediation notes from logs or runbooks
- Machine‑learning suggestions or similarity detection between failures
- Full‑fledged document collaboration (simultaneous editing, comments)
- Integration with external knowledge‑management platforms beyond simple linking
- Migration of pre‑existing remediation notes from other systems (can be addressed as a separate project)

## Functional requirements
1. **Note creation** – A user with edit rights can add a note to any failure via a modal or inline editor; the note must contain a title (max 200 chars) and a body (max 20k chars, Markdown).  
2. **Note lifecycle** – Notes can be soft‑deleted (hidden but recoverable by admins). Hard deletion is an admin‑only action that removes the record and its audit history.  
3. **Status and visibility** – Each note has a status (`draft`, `in-progress`, `resolved`, `archived`) and a visibility flag (public to the team or private to author). Only public notes appear in searches for other users.  
4. **Cross‑linking** – When viewing a note, the system shows all associated failure records. Users can attach an existing note to a new failure via a search‑and‑link dialog.  
5. **Search & filtering** – A global search bar accepts text that matches title or body content. Filter chips allow narrowing by status, author, date range, or failure type.  
6. **Audit trail** – Every change (create, edit, status change, visibility toggle, link/unlink, delete) generates an audit entry with who, what, and when, visible on the note’s history panel.  
7. **Notifications** – When a note is created or its status changes, relevant stakeholders (e.g., failure assignee, watchers) receive a notification (in‑app and optional email).  
8. **API** – REST endpoints for CRUD operations on notes, linking, and search, mirroring the UI capabilities.  
9. **Access control** – Permissions are checked against the failure record’s project/team ownership; a separate role `failure_notes_admin` allows hard‑delete and global audit access.  

## Acceptance criteria
1. A developer opens a failed test run detail page, clicks “Add Remediation Note”, enters a title and body, selects “draft” status, and saves. The note appears in the failure’s notes list with the author’s name and creation time.
2. An SRE views a deployment failure, sees two existing notes, clicks one to edit, changes its body and sets status to “resolved”. The note’s history shows the edit event; a notification is sent to the failure’s assignees.
3. A QA engineer uses the global search to find notes containing “timeout”. Results show notes across all failure types, filtered by “resolved” status. Clicking a result opens the note with its linked failures listed.
4. An admin hard‑deletes a note from the admin panel; the note disappears from all linked failures, and its audit log remains accessible to admins for 90 days.
5. A service account uses the API to create a remediation note attached to a failure ID, with public visibility. The note is immediately searchable in the UI by authorized users.
6. A user without edit permissions attempts to add a note to a failure; the UI hides the “Add Note” button, and the API returns a 403 error.
7. A note’s cross‑links are updated: a user links an existing note to a second failure; both failures now show the note, and the note’s detail view shows both linked failures.

## Out of scope
- Automatic remediation runbook execution or triggering CI/CD jobs from notes
- Integration with natural‑language processing to categorize failures
- Custom note templates or mandatory fields beyond title and body
- Bulk import/export of remediation notes
- Real‑time collaborative editing (OT/CRDT)
- Comment threads on notes (notes are immutable except for status and body edits, which generate new versions)

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