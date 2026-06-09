> **PRD** — drafted by Coder Agent (V1) · task #58
> _Each agent that updates this PRD signs its change below._

```markdown
# Product Requirements Document: Email Notification for Hen Task Completion

## 1. Problem & Goal

**Problem:** Account holders lack immediate awareness when all their associated "Hen tasks" are complete, potentially leading to delays in subsequent actions or a diminished user experience.

**Goal:** Automatically notify account holders via email upon the successful completion of all "Hen tasks" associated with their account, thereby improving user awareness and prompting further engagement within the platform.

## 2. Target Users / ICP Roles

*   **Account Holders:** Individuals or entities who own or manage an account within the system, and who have "Hen tasks" assigned or initiated under their account.

## 3. Scope

This feature focuses on sending a single, automated email notification to the primary account holder when *all* "Hen tasks" linked to their account transition to a "Complete" status.

## 4. Functional Requirements

*   **FR.1: Hen Task Completion Detection**
    *   The system SHALL detect when the last remaining "Hen task" associated with a specific account transitions to a "Complete" status.
*   **FR.2: Account Holder Email Retrieval**
    *   The system SHALL retrieve the primary email address associated with the account holder once FR.1 is met.
*   **FR.3: Email Content Generation**
    *   The system SHALL compose an email with the following static content:
        *   **Subject:** "Your Hen Tasks are Complete!"
        *   **Body:** "Good news! All Hen tasks for your account are now complete. Log in to [Platform Name] to view details and next steps. Thank you for using our service!" (Platform Name to be substituted with actual name).
*   **FR.4: Email Dispatch**
    *   The system SHALL send the composed email (FR.3) to the retrieved account holder's email address (FR.2).
*   **FR.5: Notification Logging**
    *   The system SHALL log the attempt and status (success/failure) of each email notification for auditing and debugging purposes.

## 5. Acceptance Criteria

*   **AC.1:** When all "Hen tasks" for an account are marked as "Complete," exactly one email notification is sent to the account's primary email address.
*   **AC.2:** The email notification is received by the account holder within 5 minutes of the final "Hen task" being marked "Complete."
*   **AC.3:** The subject line and body of the received email strictly match the content specified in FR.3.
*   **AC.4:** No email notification is sent if one or more "Hen tasks" for an account remain incomplete.
*   **AC.5:** No duplicate email notifications are sent for the same "all tasks complete" event.
*   **AC.6:** A log entry reflecting the email send attempt and outcome is created for each notification.

## 6. Out of Scope

*   Customization of email content by users or administrators.
*   Notifications for individual "Hen task" completion (only "all tasks complete" is in scope).
*   Notification via channels other than email (e.g., SMS, in-app, push notifications).
*   Robust email templating system beyond the static content defined in FR.3.
*   Advanced email retry mechanisms for failed sends (basic logging is in scope).
*   Batching of notifications for multiple accounts simultaneously.
*   User preferences for opting in/out of this specific notification type.
```