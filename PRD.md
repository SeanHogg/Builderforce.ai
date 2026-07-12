> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #255
> _Each agent that updates this PRD signs its change below._

# PRD: Welcome & Project Setup

## Problem & Goal

New users and team leads lack a structured onboarding flow to establish a project's foundational identity — name, description, team composition, and deadlines — before any meaningful work begins. This absence forces teams to rely on ad-hoc communication (Slack messages, emails, spreadsheets) to align on basics, leading to misalignment, duplicated effort, and delayed project starts.

**Goal:** Deliver a guided Welcome & Project Setup experience that captures all critical project metadata at project creation time, ensuring every stakeholder enters the workspace with a shared, persisted understanding of the project's identity, team, and timeline.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Project Owner / Admin** | Creates the project, defines its name, description, and deadline; invites team members |
| **Team Member (Contributor)** | Views project context on first login; understands their role and project timeline |
| **Workspace Admin** | Oversees multiple projects; needs consistent metadata for reporting and governance |

---

## Scope

This PRD covers the **initial project setup wizard and welcome screen** only — from the moment a user creates a new project through the point at which the project dashboard becomes accessible to all invited team members.

---

## Functional Requirements

### FR-1 — Project Identity
- **FR-1.1** The system must allow the project creator to enter a **project name** (required, 3–100 characters, unique within the workspace).
- **FR-1.2** The system must allow entry of a **project description** (optional, up to 500 characters, supports plain text).
- **FR-1.3** The project name and description must be editable post-creation by users with Owner or Admin roles.

### FR-2 — Team Setup
- **FR-2.1** The creator must be able to **invite team members** by email address (one or many) during setup.
- **FR-2.2** Each invited member must be assigned a **role** from a predefined set: `Owner`, `Admin`, `Contributor`, `Viewer`.
- **FR-2.3** Invitees must receive an **email invitation** containing a link to join the project.
- **FR-2.4** The system must display a **pending invitations list** so the creator can track who has not yet accepted.
- **FR-2.5** Team members may be added or removed after setup by users with Owner or Admin roles.

### FR-3 — Deadlines & Timeline
- **FR-3.1** The creator must be able to set a **project start date** (defaults to today) and a **project end / deadline date** (required).
- **FR-3.2** The end date must not be earlier than the start date; the system must surface an inline validation error if violated.
- **FR-3.3** Dates must be stored in **UTC** and displayed in the user's local timezone.
- **FR-3.4** The creator may optionally add **key milestones** (name + date) during setup (up to 10 milestones at creation time).

### FR-4 — Welcome Screen
- **FR-4.1** Upon first login to a newly created project, each team member must see a **Welcome Screen** that displays: project name, description, their assigned role, project start/end dates, and team member count.
- **FR-4.2** The Welcome Screen must include a clear **"Get Started" CTA** that navigates the user to the project dashboard.
- **FR-4.3** The Welcome Screen must not be shown again to the same user for the same project after they have dismissed it.

### FR-5 — Persistence & Validation
- **FR-5.1** All setup data must be **auto-saved** as the user progresses through setup steps (no data loss on accidental navigation away).
- **FR-5.2** The system must prevent project creation from completing without a valid project name and end date.
- **FR-5.3** Setup progress must be resumable — if the creator closes the wizard mid-flow, they can return to complete it.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A project creator can complete the full setup wizard (name → description → team → dates) in a single session and land on the project dashboard within 3 minutes. |
| AC-2 | Submitting the wizard without a project name or end date surfaces field-level validation errors and blocks progression. |
| AC-3 | All invited team members receive an invitation email within 2 minutes of the creator sending invitations. |
| AC-4 | Setting an end date earlier than the start date surfaces an inline error and prevents form submission. |
| AC-5 | A team member who accepts an invitation and logs in for the first time sees the Welcome Screen before the dashboard. |
| AC-6 | The Welcome Screen does not reappear for the same user on the same project after they click "Get Started." |
| AC-7 | Closing and reopening the setup wizard mid-flow resumes from the last completed step with all previously entered data intact. |
| AC-8 | Project name, description, team members, roles, and dates are all accurately reflected on the project dashboard immediately after setup completion. |
| AC-9 | All dates displayed to users reflect their local timezone while being stored in UTC. |
| AC-10 | A project with a duplicate name within the same workspace is rejected with a clear error message. |

---

## Out of Scope

- **Project templates** — pre-filled setup from reusable templates is a future initiative.
- **SSO / SAML-based team provisioning** — bulk user import via directory sync is not included in this release.
- **Billing and plan enforcement** — seat limits and plan gating are handled by a separate billing subsystem.
- **Task / work item creation** — this PRD covers setup metadata only; task management begins post-setup on the dashboard.
- **Advanced permissions** — granular, resource-level permissions beyond the four predefined roles are out of scope.
- **Mobile-native app** — setup wizard is web-only; mobile responsiveness is desired but a dedicated native flow is not in scope.
- **Milestone management** — editing, deleting, or tracking milestones beyond initial creation is handled by the Timeline module.
- **Notifications & reminders** — deadline reminder notifications are owned by the Notifications team and not part of this flow.