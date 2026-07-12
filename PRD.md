> **PRD** — drafted by Ada (Sr. Product Mgr) · task #155
> _Each agent that updates this PRD signs its change below._

# Diagnostic Question Engine - Structured Intake for Project Health

### Problem & Goal

*Task:* Understanding project health through a structured diagnostic question process to help PM/Leaders set expectations and manage workloads.

**Goal:**

* As a PM/Leader, I want a system that asks me a structured set of diagnostic questions when I onboard a project, so that the platform understands my project's health baseline.

### Target Users / ICP Roles

For PM/Leaders.

### Scope

* Functional requirements: Define the canonical question set covering various aspects of project health (timeline, budget, quality, risk, team, stakeholder alignment).
* Acceptance criteria: Questions adapt based on answers, save answers as a structured health profile attached to the project and allow re-running the diagnostic at any time to capture changes.

### Functional Requirements

1. **Diagnostic Question Categories:** Define the six categories mentioned in "Problem & Goal."
2. **Interactive Mode:** Support both guided and express input modes to accommodate different user preferences and technical levels.
3. **Adaptive Responses:** Implement branching logic to guide the conversation based on user input. For example, if a user answers "overdue" for a deadline (Question Category 1, Timeline & Deadlines), the system will drill down into the root cause and ask further questions.
4. **Persistence:** Save the user's responses as a structured health profile (JSON/XML/etc.) that can be attached to the project.
5. **Reusability:** Allow users to re-run the diagnostic at any time to capture changes.

### Out of Scope

* Integration with external services, such as CRM or time tracking systems.
* Advanced analytics or predictive modeling using machine learning algorithms.

This PRD focuses on the structure and presentation of questions for the project diagnostic engine [replace with actual system or tool]. The out of scope section addresses focus areas that were not covered by this PRD.