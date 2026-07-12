> **PRD** — drafted by Ada (Sr. Product Mgr) · task #513
> _Each agent that updates this PRD signs its change below._

## Product Requirements Document: Daily PM/Lead Notification System

### 1. Problem & Goal

**Problem:** Project Managers (PMs) and Team Leads currently lack a consolidated, timely overview of new or recently changed tasks within their purview, potentially leading to missed updates or reactive management.

**Goal:** To implement a reliable daily notification system that provides PMs and Leads with a summary of new or significantly changed tasks relevant to them, ensuring they are consistently informed without information overload.

### 2. Target Users / ICP Roles

*   **Project Managers (PMs):** Responsible for overseeing project progress and task statuses.
*   **Team Leads:** Responsible for managing team tasks and ensuring timely completion.

### 3. Scope

This feature encompasses the creation of a system to:
*   Trigger daily notifications at a consistent time.
*   Allow PMs/Leads to configure their notification preferences and targets.
*   Generate a summary of new or changed tasks relevant to the user within the last 24 hours.
*   Deliver these summaries via email and in-app notifications.
*   Ensure that notifications are deduplicated to only report truly new or updated information.

### 4. Functional Requirements

*   **FR.1 Daily Notification Trigger:** The system shall implement a calendar-based cron job to trigger daily notification generation events.
*   **FR.2 Configurable Send Time:** The daily notification trigger shall be configured for 08:50 UTC by default, with consideration for account-level timezone settings and Daylight Saving Time (DST) adjustments.
*   **FR.3 User Role-Based Preferences:** The system shall allow users with PM/Lead roles to configure their individual notification preferences, including target delivery channels and specific content filters if applicable.
*   **FR.4 Notification Content Generation:** The system shall generate a summary containing a list of new or significantly changed tasks relevant to the recipient within the last 24 hours.
*   **FR.5 Multi-Channel Delivery:** The generated summary shall be delivered to the recipient via email and an in-app notification interface, based on user preferences.
*   **FR.6 Deduplication Logic:** The system shall implement a mechanism to identify and persist references to tasks included in previous 24-hour summaries for a given recipient, preventing the re-notification of the same 'new' or 'changed' status. Only genuinely new changes or tasks not previously reported for the period should be included.

### 5. Acceptance Criteria

*   **AC.1 Timely Delivery:** Daily notifications are consistently delivered to target PMs/Leads *before* 9:00 AM local time, accurately accounting for configured time zones and DST.
*   **AC.2 Accurate Summary:** The delivered notification summary accurately reflects all new or significantly changed tasks relevant to the recipient within the preceding 24-hour period.
*   **AC.3 No Duplication:** No task or status change is reported multiple times as 'new' or 'changed' to the same recipient across consecutive daily notifications, nor are duplicate entries present within a single notification.
*   **AC.4 Preference Adherence:** Notifications are only sent to PM/Lead roles who have opted-in or configured their preferences, and delivery respects their chosen channels.

### 6. Out of Scope

*   Real-time notifications for individual task changes.
*   Notifications for roles other than Project Managers and Team Leads.
*   Customization of notification content beyond the summary of new/changed tasks.
*   Delivery channels other than email and in-app notifications.
*   Inclusion of task changes older than the last 24-hour period.