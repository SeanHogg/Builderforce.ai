> **PRD** — drafted by Ada (Sr. Product Mgr) · task #529
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

**Problem:** Employers and freelancers on the platform currently lack a structured way to exchange messages within the context of a specific job engagement. Communication is disjointed, making it difficult to track conversations, manage unread messages, and stay notified about new replies.

**Goal:** Deliver a backend API that enables direct, threaded messaging tightly coupled to an engagement (job_id). Employers and freelancers can create and retrieve conversations, send messages, see accurate unread counts, and receive notifications—all through a clear, RESTful interface.

## Target Users / ICP Roles

- **Employer** – a user who posts jobs and manages engagements.
- **Freelancer** – a user who applies to and works on jobs.

## Scope

The implementation includes:

- Conversation threads identified by a `job_id` and participants.
- Message creation, retrieval, and ordering (oldest first) within a conversation.
- Per-user unread message counts per conversation.
- Notification generation when a new message is sent to another user.
- Notification cleanup (marking as read) when messages are viewed.
- REST API design with data models, routes, and schema.
- Backend service layer built on SQLAlchemy/SQLModel.
- API routes for `/messages`, `/conversations`, and `/notifications`.
- Alignment with existing frontend mock API patterns (task #374).

## Functional Requirements

1. **Conversation Management**
   - A conversation is scoped to a specific `job_id` and exactly two participants (employer, freelancer).
   - Users can retrieve all conversations they participate in.
   - A conversation can be created (or fetched if already exists) based on `job_id` and participant IDs.

2. **Message Management**
   - Messages belong to a conversation.
   - Sender must be a participant in the conversation.
   - Messages are returned in chronological order (oldest first).
   - Supports text content and sender identification.
   - Timestamps recorded for sent time.

3. **Unread Count Tracking**
   - Each user has an unread count per conversation.
   - Count increments when a message is sent by the other participant.
   - Count resets to zero when the user views/reads the conversation (explicit read action).
   - Unread counts are returned with conversation metadata.

4. **Notifications**
   - A notification is created for the recipient when a new message is sent.
   - Notification includes references to the conversation and message.
   - Notifications marked as read when the recipient opens the conversation (read action).
   - Notification API allows retrieval of unread notifications for the authenticated user.

5. **Data Integrity & Authorization**
   - Only participants of an engagement can access its conversation and messages.
   - Actions are scoped to the authenticated user.

## Acceptance Criteria

- An employer and a freelancer can exchange messages within a conversation tied to a job engagement.
- Conversations can be created or retrieved by specifying the user and the job.
- Unread message counts correctly reflect new messages from the other party and reset upon reading.
- A notification is generated each time a message is sent, visible to the intended recipient.
- The API supports marking messages/conversations as read, which clears unread counts and dismisses related notifications.
- All endpoints return appropriate HTTP status codes and follow the established REST conventions.

## Out of Scope

- Real-time messaging (WebSockets, push updates); only REST/HTTP request-response.
- Group conversations with more than two participants.
- File attachments, image sharing, or rich media.
- Message editing or deletion.
- Delivery receipts or typing indicators.
- Frontend UI implementation (frontend will consume this API separately).
- Integration with third-party notification services (e.g., email, push).

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