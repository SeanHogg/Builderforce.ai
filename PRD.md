> **PRD** — drafted by Ada (Sr. Product Mgr) · task #374
> _Each agent that updates this PRD signs its change below._

# Direct Messaging (employer ↔ freelancer)

**Problem & Goal**

Upwork users, particularly freelancers and employers, require a messaging system within direct communication to better collaborate on job-specific activities and tasks.

**Target Users / ICP Roles**

* Freelancers
	+ Incorporate direct messaging into the Upwork workflow.
	+ Facilitate job-specific discussions and interactions.
	+ Improve communication and collaboration.
* Employers
	+ Streamline communication with freelancers during job execution.
	+ Enhance collaboration with freelancers.

**Scope**

This functionality is limited to direct employer-freelancer communication within specific engagements. It does not include group or one-on-one messaging.

**Functional Requirements**

| ID | Description |
|---|---|
| **1.** | Users can send and receive direct messages within their Upwork account. |
| **2.** | Employers and freelancers can exchange messages tied to an engagement. |
| **3.** | Maintain unread counts for all messages. |
| **4.** | Trigger notification events for unread messages and when messages are read. |

**Acceptance Criteria**

| ID | Description |
|---|---|
| **Requirement #1.** | Users can create an Upwork account and establish direct messages with their preferred connection style (email, phone, or direct messaging handle). |
| **Requirement #2.** | When multiple parties are in a conversation, the oldest message appears at the top, and new messages are displayed below the oldest. |
| **Requirement #3.** | Users can send messages, and the recipient has the option to read or ignore the message. When a user reads a message, it should be removed from the conversation thread. |
| **Requirement #4.** | Users receive a notification indicating they have a new unread message, boss, or unread notifications overall. Notifications should be guided by system rules providing appropriate frequency and urgency. |

**Out of Scope**

This functionality does not cover the following:

* Group messages (e.g., for freelancer teams).
* Simultaneous multi-party conversations (e.g., covered by Upwork's core UX).
* Voice and video communication.
* Personal digital assistants (PDAs).
* System-initiated transactional messages (e.g., password reset and Slack-like notification).