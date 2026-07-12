> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #274
> _Each agent that updates this PRD signs its change below._

# PRD: Adaptive Branching Question Logic

## Problem & Goal

Static question flows force all users through identical paths regardless of their answers, creating friction, collecting irrelevant data, and missing opportunities to gather deeper context when anomalies arise. When a respondent flags a critical condition — such as an overdue item, a failed check, or an escalating risk — the system must intelligently route them into targeted follow-up sequences to capture root causes, assign accountability, and surface actionable intelligence.

**Goal:** Implement a dynamic, condition-driven branching engine that adapts the question sequence in real time based on prior answers, enabling deep-dive follow-ups only when relevant while keeping the baseline flow concise for all other respondents.

---

## Target Users / ICP Roles

| Role | Context |
|---|---|
| **Form/Survey Designers** | Operations managers, QA leads, compliance officers, and product teams who build and maintain question flows |
| **End Respondents** | Field technicians, account managers, project leads, or any staff completing structured data-entry forms |
| **Analysts / Reviewers** | Data analysts and managers who consume responses and need contextually rich, structured data for decisions |
| **System Administrators** | Platform admins who govern logic templates, permissions, and audit trails |

---

## Scope

This PRD covers the branching logic layer of the form/questionnaire system. It defines how questions are shown, hidden, or injected based on the evaluation of prior responses. It does not cover the underlying form rendering engine (assumed to exist) beyond the interface points described here.

---

## Functional Requirements

### FR-1: Condition Definition
- Designers must be able to define one or more **conditions** on any question, referencing any earlier answer in the same flow.
- Supported condition types:
  - Equality / inequality (`==`, `!=`)
  - Numeric comparisons (`>`, `<`, `>=`, `<=`)
  - Boolean flags (`is true`, `is false`)
  - Text contains / does not contain
  - Selection includes one or more values (for multi-select)
  - Null / not-null checks

### FR-2: Branch Actions
Each condition must map to one or more **actions**:
- **Show question(s)** — inject one or more follow-up questions after the trigger question
- **Skip question(s)** — suppress one or more questions that would otherwise appear
- **Jump to section** — advance to a named section of the flow
- **End flow** — terminate the questionnaire early with an optional closing message
- **Set variable** — assign a computed or static value to a named variable for downstream logic

### FR-3: Multi-Level / Nested Branching
- A question revealed by a branch must itself be capable of triggering further branches (minimum 5 levels of nesting).
- Circular references must be detected at design time and rejected with a descriptive error.

### FR-4: Compound Conditions
- Designers must be able to combine conditions using `AND` / `OR` operators with explicit grouping (parenthetical precedence) to form a single branch rule.

### FR-5: Real-Time Evaluation
- Branching logic must evaluate and update the visible question set **immediately** upon answer input, without requiring a page reload or explicit "next" submission, in single-page flow mode.
- For paginated flows, evaluation occurs on page advancement.

### FR-6: Progress Integrity
- Progress indicators (e.g., "Question 4 of 12") must dynamically update as branches add or remove questions from the remaining path.
- The displayed count must reflect only the questions currently in scope for that respondent's path, not the total possible question count.

### FR-7: Branching Logic Designer UI
- A visual rule builder must allow designers to:
  - Select a trigger question and a specific answer value or range
  - Choose a branch action and target question(s) or section
  - Add compound conditions via a GUI without writing code
  - Preview the flow as a directed graph (nodes = questions, edges = conditions)
  - Simulate a walkthrough by entering test answers and seeing the resulting path highlighted

### FR-8: Logic Validation
- On save, the system must validate:
  - No orphaned questions (questions unreachable by any path)
  - No circular references
  - No conflicting rules that could produce contradictory actions for the same condition state
- Warnings (non-blocking) for questions that are only reachable via a single rare condition path

### FR-9: Answer & Path Persistence
- All answers, including those to branch-injected questions, must be stored in the response record with their question ID, the condition that triggered their display, and the answer value.
- Skipped questions must be stored as `null` / `skipped` with the rule ID that caused the skip, enabling analysts to distinguish "not asked" from "not answered."

### FR-10: Branching Rule Versioning
- Each published form version must snapshot its branching logic.
- Editing branching rules must create a new form version; live in-progress sessions must continue on the version they started.

### FR-11: API Access
- A rules engine API endpoint must accept an `{ answerId, value, formVersionId }` payload and return the next set of question IDs to render, enabling headless/embedded clients to consume branching logic server-side.

---

## Acceptance Criteria

### AC-1: Basic Branch Trigger
> **Given** a question with a condition `if answer == "yes"` targeting a follow-up question,  
> **When** the respondent selects "yes,"  
> **Then** the follow-up question appears immediately in the flow before the next standard question.

### AC-2: Branch Suppression
> **Given** the same question with condition `if answer == "no"` mapped to skip the follow-up,  
> **When** the respondent selects "no,"  
> **Then** the follow-up question is not displayed and the flow advances to the next standard question.

### AC-3: Overdue Root-Cause Drill-Down (Reference Scenario)
> **Given** a question "Is this task overdue?" with a branch rule `if answer == "yes"`,  
> **When** the respondent answers "yes,"  
> **Then** a sub-sequence of root-cause questions (e.g., "What is the primary cause?", "Which team is responsible?", "What is the revised ETA?") is injected immediately after, and all responses are stored under the parent response record.

### AC-4: Nested Branching
> **Given** a branch-injected question "Primary cause?" with its own branch rule `if answer == "Resource shortage"`,  
> **When** the respondent selects "Resource shortage,"  
> **Then** a second-level follow-up question appears without affecting the outer flow sequence.

### AC-5: Compound Condition
> **Given** a rule `if (status == "overdue") AND (severity >= 3)`,  
> **When** both conditions are true simultaneously,  
> **Then** the branch fires; if either condition is false, the branch does not fire.

### AC-6: Progress Counter Accuracy
> **Given** a flow with 8 base questions and a 3-question branch triggered at Q2,  
> **When** the branch fires, the progress indicator must update to reflect the new total (up to 11) from that point forward.

### AC-7: Circular Reference Rejection
> **Given** a designer creates a rule where Question A branches to Question B and Question B branches back to Question A,  
> **When** the designer attempts to save,  
> **Then** the system rejects the save and displays an error identifying the circular path.

### AC-8: Skipped Question Storage
> **Given** a question skipped due to a branch rule,  
> **When** the response is retrieved via the data export or API,  
> **Then** the skipped question appears in the response payload with `"status": "skipped"` and `"skip_rule_id": "<ruleId>"`.

### AC-9: Version Isolation
> **Given** a respondent begins a form on version 2,  
> **When** a designer publishes version 3 with modified branch rules,  
> **Then** the in-progress session continues to evaluate version 2 rules until submission.

### AC-10: Headless API Branching
> **Given** a POST to `/api/branching/next` with a valid `formVersionId`, `answerId`, and `value`,  
> **When** a matching branch rule exists,  
> **Then** the API returns HTTP 200 with the ordered list of next question IDs within 300 ms (p95).

---

## Out of Scope

- **Form rendering engine** — base UI components, styling, and accessibility of the form itself (assumed pre-existing)
- **Scoring / calculated fields** — numeric scoring or computed answer derivations beyond simple variable assignment
- **A/B testing of question flows** — randomized path assignment for experimentation purposes
- **Cross-form branching** — triggering questions in a separate form based on answers in the current form
- **Real-time collaboration** — simultaneous multi-user editing of branching logic in the designer
- **AI-generated branch suggestions** — automated recommendation of branch rules from historical response data
- **Offline-first mobile support** — client-side logic caching for no-connectivity scenarios
- **Localization of branching rules** — logic operates on raw values; translation of question text is handled by the localization layer