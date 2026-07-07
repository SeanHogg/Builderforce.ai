> **PRD** — drafted by Ada · task #165
> _Each agent that updates this PRD signs its change below._

# PRD: Autonomous Agent Task Processing Failure in "To Do" Column

## **Problem & Goal**
The autonomous agent **"Kevin BA/PM/PO (Durable)"** assigned to the **"To Do"** swimlane on the **BuilderForce.AI board** is not processing or executing tasks despite:
- Being active and properly configured.
- The swimlane being set for auto-processing.
- Tasks existing in the "To Do" column.
- Dispatch status remaining empty (no errors or logs).

### **Goal**
Restore autonomous task processing for the agent in the "To Do" swimlane, ensuring:
1. Tasks are automatically picked up and executed.
2. Dispatch logs are populated for observability.
3. Edge cases (e.g., misconfigurations, permissions) are identified and resolved.

---

## **Target Users / ICP Roles**
- **Product Owners (POs)**: Rely on the agent to automate backlog refinement and task prioritization.
- **Business Analysts (BAs)**: Use the agent to generate user stories, acceptance criteria, and documentation.
- **Project Managers (PMs)**: Depend on task automation for sprint planning and progress tracking.
- **Engineering Teams**: Expect tasks to be pre-processed (e.g., detailed, estimated) before manual intervention.
- **AI Operations Teams**: Monitor agent health and debug failures.

---

## **Scope**
### **In Scope**
1. **Diagnosis**
   - Verify agent configuration (e.g., permissions, swimlane rules, task filters).
   - Check task metadata (e.g., labels, assignees, due dates) for blockers.
   - Review agent logs for silent failures or timeouts.
   - Validate swimlane auto-processing settings (e.g., triggers, cooldowns).

2. **Resolution**
   - Fix configuration drift (e.g., missing swimlane triggers, agent permissions).
   - Address edge cases (e.g., malformed task descriptions, rate limits).
   - Implement retry logic for transient failures.
   - Add observability (e.g., dispatch status updates, heartbeat signals).

3. **Prevention**
   - Add validation for new tasks entering the "To Do" column.
   - Document troubleshooting steps for similar issues.
   - Implement monitoring alerts for silent failures.

4. **Testing**
   - Manually trigger task processing to verify fixes.
   - Simulate edge cases (e.g., empty tasks, rate limits) in a staging environment.

### **Functional Requirements**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | The agent must log all dispatch attempts (success/failure) in the swimlane’s activity stream. | P0 |
| FR2 | Tasks must include a `last_processed_at` timestamp to track staleness. | P1 |
| FR3 | The swimlane must reject tasks missing required metadata (e.g., title, description). | P1 |
| FR4 | The agent must respect task priority labels (e.g., `P0`, `P1`) when processing. | P2 |
| FR5 | Configuration changes to the swimlane/agent must require admin approval. | P2 |

---

## **Acceptance Criteria**
1. **Diagnosis**
   - Agent logs confirm tasks are being polled from the "To Do" column.
   - Dispatch status updates show either:
     - Task execution progress, **or**
     - Clear error messages (e.g., "Permission denied", "Rate limit exceeded").

2. **Task Processing**
   - ≥95% of valid tasks in "To Do" are processed within 5 minutes of assignment.
   - Tasks with malformed metadata are flagged and moved to "Blocked" column.

3. **Observability**
   - Dispatch status includes:
     - Timestamp of last attempt.
     - Task ID and title.
     - Status (e.g., "Processing", "Failed", "Completed").
   - Alerts are triggered for:
     - Agent inactivity >10 minutes.
     - Consecutive failed tasks (>3 in a row).

4. **Documentation**
   - Troubleshooting guide covers:
     - Permission issues.
     - Swimlane configuration.
     - Task metadata requirements.

---

## **Out of Scope**
- **Multi-agent coordination**: This PRD focuses solely on the single agent "Kevin BA/PM/PO". Conflicts between multiple agents in the same swimlane are out of scope.
- **Task creation**: Issues with task creation (e.g., from templates, integrations) are not addressed.
- **Non-"To Do" columns**: Solutions for other swimlanes (e.g., "In Progress", "Done") are not covered.
- **AI model tuning**: Adjustments to the agent’s underlying LLM (e.g., prompt engineering) are out of scope.
- **UI changes**: Updates to the board/swimlane UI (e.g., drag-and-drop, colors) are not included.