> **PRD** — drafted by Bob Developer (V2 (Container)) · task #372
> _Each agent that updates this PRD signs its change below._

## Product Requirements Document (PRD): Recurring Subscription Billing

### Problem & Goal

**Problem:**
The current system, specifically `HelcimProvider.ts:78`, is limited to processing one-time charges. This prevents us from offering recurring billing schedules and comprehensive subscription management for our Teams and Enterprise plans. As a result, we cannot effectively monetize these higher-tier offerings through automated, recurring payments.

**Goal:**
Implement a robust recurring subscription billing system for Teams and Enterprise plans. This includes supporting subscription schedules, comprehensive plan management, and automated dunning processes to ensure continuous revenue generation and a smooth customer experience.

### Target Users / ICP Roles

*   **Teams/Enterprise Account Administrators:** Users responsible for managing their organization's subscription to our service.
*   **Internal Customer Success/Support Teams:** Internal stakeholders who will manage and troubleshoot customer subscriptions and billing issues.

### Scope

This initiative focuses on enabling recurring billing functionality, subscription lifecycle management, and automated dunning specifically for Teams and Enterprise plans. It will integrate with our existing Helcim payment gateway.

### Functional Requirements

1.  **Subscription Creation:**
    *   An API endpoint and internal administrative interface for creating new subscriptions, linking a Teams/Enterprise account to a specific plan (e.g., "Teams Monthly," "Enterprise Annually").
    *   During subscription creation, establish the recurring billing schedule and initial charge via Helcim.
2.  **Recurring Billing & Payment Processing:**
    *   Automated system for processing recurring charges on scheduled intervals (e.g., monthly, annually) using the Helcim payment gateway.
    *   Robust handling of successful and failed payment notifications from Helcim, updating subscription status accordingly.
3.  **Subscription Lifecycle Management:**
    *   **Renewal:** Automatic subscription renewal at the end of each billing cycle, triggering a new recurring charge.
    *   **Cancellation:**
        *   Ability to cancel an active subscription via an administrative interface.
        *   Support for immediate cancellation or cancellation at the end of the current billing period.
    *   **Modification:**
        *   Ability to change a subscription's plan (e.g., upgrade/downgrade) via an administrative interface.
        *   Ability to modify the billing frequency (e.g., monthly to annually).
4.  **Dunning Management:**
    *   Configurable, automated retry schedule for failed recurring payments (e.g., 3 retries over 7 days).
    *   Automated email notifications to the subscribed account administrators regarding payment failures and the dunning process status.
    *   Mechanism for users to update their payment method during a dunning period.
    *   Automatic transition of subscription status (e.g., `past_due`, then `canceled`) based on dunning outcome.
5.  **Subscription State & History:**
    *   Persistent storage of subscription details: plan, status (e.g., `active`, `canceled`, `past_due`), current billing period, next billing date, and associated payment history.
    *   An administrative interface to view all active, past due, and canceled subscriptions, including their detailed history.
6.  **Internal Notifications & Logging:**
    *   Generate internal system events/logs for key subscription lifecycle events: `subscription_created`, `subscription_renewed`, `subscription_payment_succeeded`, `subscription_payment_failed`, `subscription_canceled`.

### Acceptance Criteria

*   A Teams/Enterprise account can be successfully subscribed to a recurring plan.
*   The initial subscription charge is processed correctly through Helcim.
*   Subsequent recurring charges are processed automatically on their scheduled billing dates.
*   In the event of a failed recurring payment, the system initiates the defined dunning process, including automated retries and customer notifications.
*   The system accurately updates subscription status through its lifecycle (e.g., `active`, `past_due`, `canceled`) and after dunning outcomes.
*   An administrator can view the current status and historical events of any subscription.
*   An administrator can successfully cancel an active subscription, with options for immediate or end-of-cycle termination.
*   Internal system logs reflect all key subscription lifecycle events: `created`, `renewed`, `failed`, `canceled`, `payment_succeeded`, `payment_failed`.

### Out of Scope

*   Public-facing self-service portal for end-users to manage their own subscriptions (initially, management will be via an internal admin interface).
*   Detailed prorated billing logic for mid-cycle plan changes (focus on full cycle changes first).
*   Complex promotional codes, coupons, or discounting systems.
*   Integration with external CRM or accounting systems beyond basic transaction data required by Helcim.
*   Free trial management.
*   One-time charge processing (existing functionality).
*   Detailed tax calculation beyond what Helcim natively supports for recurring charges.