> **PRD** — drafted by Ada (Sr. Product Mgr) · task #375
> _Each agent that updates this PRD signs its change below._

# PRD: Milestone / Payment-Release System (Fixed-Bid)

## Problem & Goal

Fixed-bid contracts on the platform currently have no structured way to break work into discrete deliverable chunks tied to payment. Deliverables are evaluated informally, escrow funds are held without a defined release trigger, and there is no enforceable flow connecting approval to fund disbursement. This creates financial risk for both clients (paying before value is confirmed) and contractors (no guaranteed payment on completion of a defined unit of work).

**Goal:** Implement a milestone system for fixed-bid jobs that enforces a `deliver → review → approve → release` lifecycle, where each approved milestone programmatically triggers an escrow release for the corresponding portion of the contract value.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Client** | Define milestones upfront, review submissions, approve or request revisions, and release funds with confidence. |
| **Contractor** | Understand exactly what must be delivered per milestone, submit deliverables against a milestone, and receive payment immediately upon approval. |
| **Platform Admin** | Mediate disputes, override stuck milestone states, audit the full lifecycle trail. |

---

## Scope

This milestone system applies exclusively to **fixed-bid jobs**. Hourly contracts are out of scope. The system depends on an active escrow integration (Issue #370) and assumes escrow funds are already locked at contract start.

---

## Functional Requirements

### 1. Milestone Data Model

- A **Milestone** entity must be a first-class data object linked to a fixed-bid contract (Job), not a tag or free-form note.
- Required fields per milestone:
  - `id` (UUID)
  - `job_id` (FK → Job)
  - `contract_id` (FK → Contract)
  - `title` (string, required)
  - `description` (text, optional)
  - `amount` (decimal, required — portion of total contract value)
  - `due_date` (date, optional)
  - `position` (integer — ordered sequence within the contract)
  - `status` (enum: `pending` | `in_progress` | `submitted` | `revision_requested` | `approved` | `released` | `disputed`)
  - `created_at`, `updated_at`, `submitted_at`, `approved_at`, `released_at`
- The sum of all milestone `amount` values for a contract must equal the total contract value; the system must enforce this invariant at creation and when milestones are edited.
- A contract must have at least one milestone.

### 2. Milestone Creation & Editing

- Clients can define milestones during job posting (before contract is signed) or at contract initiation.
- Clients can add, edit (title, description, amount, due_date), or reorder milestones while the contract status is `draft` or `active` and no milestone in the set has progressed past `pending`.
- Once a milestone moves to `in_progress` or beyond, its `amount` is locked and cannot be edited.
- Contractors must acknowledge the milestone plan before the contract becomes `active`.

### 3. Deliver → Review → Approve → Release Flow

#### 3a. Deliver (Contractor)
- Contractor marks a milestone as **submitted** by attaching one or more deliverables (file uploads, URLs, and/or a text description).
- Only the active milestone (lowest `position` with status `in_progress` or `pending`) can be submitted; milestones must be completed in order unless the client explicitly unlocks out-of-order submission.
- System timestamps `submitted_at` and notifies the client.

#### 3b. Review (Client)
- Client enters a **review window** (configurable platform default: 7 days) upon submission.
- Client can:
  - **Approve** the milestone → triggers approval flow (3c).
  - **Request revision** → milestone returns to `in_progress`, with a required revision note. Contractor is notified.
- If the review window expires without action, the system sends reminder notifications at 24 h and 2 h before expiry. Auto-approval behavior on window expiry is a platform configuration setting (default: **off**; admin can enable per contract or globally).

#### 3c. Approve
- Client explicitly approves the milestone submission.
- System sets `status = approved` and `approved_at = now()`.
- System immediately initiates escrow release for the milestone `amount` to the contractor.
- Approval is irreversible; no edits are permitted after this state.

#### 3d. Release (Escrow)
- On approval, the platform calls the escrow service (Issue #370) to release `amount` to contractor.
- On successful escrow release response, milestone `status` transitions to `released` and `released_at` is recorded.
- On escrow failure, the milestone stays in `approved` state; the platform retries per the escrow service's retry policy and surfaces an error to both parties and platform admin.
- A release receipt (amount, timestamp, reference ID from escrow service) is stored on the milestone record and visible to both parties.

### 4. Dispute Handling

- Either party can open a dispute on a milestone in `submitted` or `revision_requested` state.
- A disputed milestone is locked (`status = disputed`); no actions (submit, approve, release) are permitted until an admin resolves it.
- Admin can resolve by: approving the milestone (triggers 3c), rejecting the submission (returns to `in_progress`), or cancelling the milestone (requires contract-level handling).
- Full audit trail of all status transitions, actor, and timestamp is stored.

### 5. Notifications

- Contractor notified when: milestone is activated, revision is requested, milestone is approved, funds are released.
- Client notified when: milestone is submitted, review window reminder (24 h, 2 h), dispute is resolved.
- Admin notified when: escrow release fails, dispute is opened.
- All notifications sent via the platform's existing notification service (email + in-app).

### 6. Dashboard & Visibility

- Contract detail page displays an ordered milestone tracker showing status, amount, due date, and submission/approval timestamps for each milestone.
- Both parties can see the full milestone list and current states at all times.
- Clients see an **Approve** / **Request Revision** action UI on submitted milestones; contractors see a **Submit Deliverable** action on active milestones.
- A running total shows: total contract value, amount released to date, amount in escrow pending, amount on unstarted milestones.

### 7. API Endpoints (minimum required)

| Method | Path | Actor | Description |
|---|---|---|---|
| `POST` | `/contracts/:id/milestones` | Client | Create one or more milestones |
| `GET` | `/contracts/:id/milestones` | Both | List milestones for a contract |
| `PATCH` | `/contracts/:id/milestones/:mid` | Client | Edit a pending milestone |
| `POST` | `/contracts/:id/milestones/:mid/submit` | Contractor | Submit deliverable |
| `POST` | `/contracts/:id/milestones/:mid/approve` | Client | Approve milestone |
| `POST` | `/contracts/:id/milestones/:mid/request-revision` | Client | Request revision |
| `POST` | `/contracts/:id/milestones/:mid/dispute` | Both | Open dispute |
| `POST` | `/admin/milestones/:mid/resolve` | Admin | Resolve dispute |

---

## Acceptance Criteria

1. **AC-1 — Milestone setup:** A fixed-bid job can be split into two or more milestones; the platform rejects any configuration where the sum of milestone amounts ≠ total contract value.
2. **AC-2 — Ordered delivery:** A contractor cannot submit Milestone 2 while Milestone 1 is in `pending` or `in_progress` status (unless unlocked by client).
3. **AC-3 — Submission flow:** When a contractor submits a milestone, its status changes to `submitted`, `submitted_at` is recorded, and the client receives a notification within 60 seconds.
4. **AC-4 — Approval triggers release:** When a client approves a submitted milestone, an escrow release call is made automatically with no additional manual step; the contractor's balance reflects the released amount within the SLA defined by the escrow service.
5. **AC-5 — Revision loop:** A client can request revisions on a submitted milestone; the milestone returns to `in_progress`; the contractor can resubmit; this loop can repeat without limit until approval or dispute.
6. **AC-6 — Release record:** After a successful escrow release, both parties can see a release receipt (amount, timestamp, escrow reference ID) on the milestone detail view.
7. **AC-7 — Dispute lock:** A disputed milestone blocks any approve or release action until an admin resolves the dispute.
8. **AC-8 — Audit trail:** Every status transition on a milestone records actor ID, role, timestamp, and is retrievable via the admin panel.
9. **AC-9 — Amount lock:** Once a milestone progresses past `pending`, attempts to edit its `amount` via the API return a `422` error.
10. **AC-10 — Full lifecycle E2E test:** An automated integration test covers: create contract → define 3 milestones → submit each → approve each → verify all three escrow releases fired and total released = total contract value.

---

## Out of Scope

- Hourly / time-tracked contracts (milestone system is fixed-bid only).
- Automatic milestone creation or AI-suggested milestone breakdowns.
- Partial approval of a single milestone's deliverables (approval is all-or-nothing per milestone).
- Multi-currency conversion within the milestone release step (handled by the escrow service).
- Client-initiated early release of funds without a submission from the contractor (addressed separately if needed).
- Mobile-native (iOS/Android) milestone UI — web responsive only in this milestone.
- Contractor-initiated payment requests / invoicing flows (separate system).
- SLA enforcement or automatic penalties for late delivery against `due_date`.