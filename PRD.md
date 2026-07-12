> **PRD** — drafted by Validator · task #489
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Autonomous Dispatch Skip Reason Visibility

## 1. Problem & Goal

### 1.1 Problem
When an autonomous task fails to auto-run upon lane entry, the reason is often not immediately discernible from the task's timeline. Currently, the system only emits an `auto_run_skipped` event for `capability_mismatch` reasons, leaving other skip reasons (`no_board`, `no_lane`, `no_agent`, `already_running`, `human_gate`, `terminal_lane`, `not_executable`) silent. This lack of visibility necessitates manual investigation using diagnostic tools (`/autorun-diagnostics`), hindering efficient troubleshooting and increasing operational overhead.

### 1.2 Goal
To ensure that all reasons for an autonomous task skipping auto-run are clearly and immediately explainable from its timeline, without requiring additional diagnostic steps.

## 2. Target Users / ICP Roles

*   **Agents/Task Assignees:** To understand why their tasks are not automatically progressing.
*   **Team Leads/Managers:** To monitor team productivity and identify bottlenecks in task flow.
*   **Operations/Support Staff:** To efficiently troubleshoot and resolve stalled or misconfigured autonomous tasks.

## 3. Scope

This PRD covers the event emission logic within the `maybeAutoRunOnLaneEntry` function for autonomous dispatch. Specifically, it addresses the generation of `auto_run_skipped` events for all non-run outcomes, ensuring comprehensive timeline visibility.

## 4. Functional Requirements

*   **FR.1: Emit `auto_run_skipped` for all skip reasons.** The autonomous dispatch mechanism (`maybeAutoRunOnLaneEntry`) shall emit an `auto_run_skipped` event for every instance where a task does not auto-run, regardless of the specific reason.
*   **FR.2: Include machine-readable reason.** Each `auto_run_skipped` event must include a machine-readable `reason` field detailing why the auto-run was skipped (e.g., `no_board`, `no_lane`, `no_agent`, `already_running`, `human_gate`, `terminal_lane`, `not_executable`, `capability_mismatch`).
*   **FR.3: Include relevant agent-ref context.** Each `auto_run_skipped` event must include the relevant `agentRef` context that informed the skip decision.
*   **FR.4: Prevent duplicate events.** The system must ensure that only one `auto_run_skipped` event is emitted per auto-run evaluation, even when specific reasons (like `capability_mismatch`) have historically been handled separately.

## 5. Acceptance Criteria

*   Every skip reason produces exactly one `auto_run_skipped` timeline event with the machine-readable reason and the relevant agent-ref context.
*   No duplicate event for `capability_mismatch` or any other reason.
*   A stuck pending ticket is explainable from its timeline without calling `/autorun-diagnostics`.

## 6. Out of Scope

*   Developing new code to implement this functionality (as it appears to be already fixed).
*   Changes or enhancements to the `/autorun-diagnostics` endpoint.
*   Altering the core logic of `evaluateAutoRun.ts` beyond ensuring its output shape (`AutoRunEvaluation`) is compatible with event emission.
*   Any changes to task execution logic once a task *does* auto-run.