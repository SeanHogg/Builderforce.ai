> **PRD** — drafted by Ada (Sr. Product Mgr) · task #754
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
When a call is transferred to a different agent, the system currently creates a duplicate row in the call log. This duplication leads to:
- Inaccurate reporting and analytics.
- Confusion for agents who see multiple entries for the same call.
- Increased storage usage and potential performance issues.

### Goal
To update the existing call log entry when a call is transferred to a different agent, ensuring that no duplicate rows are created. This will maintain accurate records and improve system efficiency.

## Target Users / ICP Roles

- **Call Center Agents**: Users who handle customer calls and need to transfer calls to other agents.
- **Call Center Managers**: Users who monitor call logs and generate reports for performance analysis.
- **IT Support**: Users who manage and maintain the call logging system.

## Scope

### In-Scope
- Update the existing call log entry with the new agent's information when a call is transferred.
- Ensure that the transfer is seamless and does not disrupt the call flow.
- Provide a clear audit trail of the transfer within the call log.
- Update reporting and analytics to reflect the accurate agent assignment.

### Out-of-Scope
- Changing the current call transfer mechanism.
- Implementing new UI elements for call transfer.
- Handling call transfers between different systems or platforms.
- Modifying the data schema for call logs (unless absolutely necessary).

## Functional Requirements

1. **Call Transfer Functionality**
   - When an agent transfers a call to another agent, the system should identify the existing call log entry.
   - The system should update the "Assigned Agent" field with the new agent's ID.
   - The system should record the timestamp of the transfer.

2. **Audit Trail**
   - Maintain a history of transfers within the call log entry.
   - Include the original agent, new agent, and timestamp for each transfer.

3. **User Notifications**
   - Notify the new agent of the transferred call.
   - Provide a brief summary of the call history to the new agent.

4. **Reporting and Analytics**
   - Ensure that reports accurately reflect the assigned agent at each stage of the call.
   - Update any relevant metrics (e.g., call duration, handle time) based on the transfer.

5. **Error Handling**
   - If the call transfer fails, the system should notify the original agent and log the error.
   - Provide retry options for the agent if the transfer fails.

## Acceptance Criteria

1. **No Duplicate Rows**
   - After a call transfer, only one entry exists in the call log for that call.
   - The entry is updated with the new agent's information.

2. **Accurate Reporting**
   - Reports generated show the correct agent assignment for each call segment.
   - Historical data reflects the transfer history accurately.

3. **Seamless User Experience**
   - The transfer process does not cause interruptions or delays in the call.
   - Agents receive timely notifications about transferred calls.

4. **Error Handling**
   - The system handles transfer failures gracefully, providing clear feedback to the agent.
   - Errors are logged for IT support to review and address.

5. **Audit Trail**
   - The call log includes a complete history of transfers, including timestamps and agent IDs.

## Out of Scope

- Modifying the call transfer workflow or UI.
- Integrating with external systems for call transfers.
- Implementing new features related to call monitoring or recording.
- Changes to the data storage architecture.

## Requirements

### Data Requirements

1. **Call Log Entry Schema**
   - Each call log entry MUST have a unique `call_id` (UUID) as the primary identifier.
   - The `assigned_agent_id` field MUST be updatable without creating a new record.
   - A `transfer_history` JSON array field MUST store transfer events with: `from_agent_id`, `to_agent_id`, `transfer_timestamp`, and optional `transfer_reason`.
   - The `call_status` field MUST reflect the current state: `active`, `transferred`, `completed`, or `failed`.

2. **Data Integrity**
   - The system MUST enforce a unique constraint on `call_id` to prevent duplicate entries.
   - All transfer operations MUST use database transactions to ensure atomicity.

### Functional Requirements

3. **Transfer Detection**
   - The system MUST detect a call transfer event through the existing transfer API/handler.
   - The transfer event MUST include: `call_id`, `from_agent_id`, `to_agent_id`, and `transfer_timestamp`.

4. **Update Logic**
   - Upon detecting a transfer, the system MUST locate the existing call log entry by `call_id`.
   - The system MUST update only the `assigned_agent_id` field (and optionally `call_status` if transferred).
   - The system MUST append a new entry to the `transfer_history` array rather than overwriting.

5. **Audit Trail Requirements**
   - Each transfer MUST record: timestamp (ISO 8601), source agent ID, destination agent ID.
   - Transfer history MUST be queryable for reporting purposes.
   - The original agent assignment MUST be preserved in the transfer history.

### Non-Functional Requirements

6. **Performance**
   - Call transfer updates MUST complete within 500ms to avoid call disruption.
   - The transfer history array SHOULD be capped at 10 entries to prevent unbounded growth.

7. **Reliability**
   - Transfer operations MUST be idempotent — re-sending the same transfer request MUST NOT create duplicate entries.
   - Failed transfers MUST NOT leave the call log in an inconsistent state (partial update).

8. **Notifications**
   - The system MUST emit a `call.transferred` event to the notification service.
   - The notification payload MUST include: `call_id`, `new_agent_id`, `transfer_history_summary`.

### Error Handling Requirements

9. **Failure Scenarios**
   - If the call ID does not exist, the system MUST create a new entry and log a warning (fallback behavior).
   - If the transfer to the same agent is attempted, the system MUST reject with an appropriate error.
   - Database connection failures MUST trigger a retry with exponential backoff (max 3 attempts).

10. **Logging**
    - All transfer attempts (success and failure) MUST be logged with correlation IDs.
    - Error logs MUST include: `call_id`, `from_agent_id`, `to_agent_id`, `error_code`, `timestamp`.

### API Requirements

11. **Transfer Endpoint Contract**
    - The existing transfer endpoint MUST accept: `{ call_id, target_agent_id, reason? }`.
    - Response MUST return the updated call log entry with transfer history.
    - HTTP status codes: 200 (success), 404 (call not found), 409 (invalid transfer), 500 (server error).

### Reporting & Analytics Integration

12. **Metrics Calculation**
    - The system MUST calculate `agent_handle_time` as the duration from agent assignment to transfer/completion.
    - Transfer count per agent MUST be trackable via the `transfer_history` query.
    - Reports MUST be able to reconstruct the call journey from the `transfer_history` array.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._