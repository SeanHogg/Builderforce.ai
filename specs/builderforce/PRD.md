> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #345
> _Each agent that updates this PRD signs its change below._

# Automated Backlog Scan on Demand (and Scheduled)

## 1. Problem & Goal

Currently, identifying new projects or opportunities within existing backlog data is a manual and resource-intensive process. The team would like to explore automating this process to improve efficiency, reduce manual errors, and provide clients with more timely and accurate project visibility.

## Target Users / ICP Roles (if relevant)

- Product Owner
- Program Manager
- Solution Architect
- Client Consultant
- Any other role that requires regular communication with the project pipeline

## 3. Scope

The automated backlog scan system will:

1. Identify new projects or opportunities within existing backlog data.
2. Automatically extract relevant information from projects and display it in a user-friendly format.
3. Be available both on demand and scheduled (e.g., weekly or monthly).

## 4. Functional Requirements

1. **Data Integration**: The system will integrate with the project management tools (e.g., Jira, Trello) to access the backlog data. The system should support data import and export formats such as JSON or XML.

   PRD Decision: This capability is OUT OF SCOPE for BuilderForce's core runtime. Implementation requires:
   - Separate Jira/Trello adapter modules (installable as BuilderForce extensions)
   - A dedicated external workload store (e.g., a second project-management connector)
   - The builderforce.ai platform will provide the orchestrator + scheduling + API; the actual Jira/Trello integrations and other ETL/logic remain external integrations. See EPIC #XXX (to be assigned) for implementation direction.

2. **Identification Algorithm**: The system will automatically identify projects or opportunities in the backlog based on predefined criteria (e.g., keywords, tags) or use machine learning algorithms to improve accuracy.

3. **Visualization**: The system should provide a user-friendly interface to display identified projects or opportunities, including details such as project status, assignees, and estimated effort.

4. **On-Demand Access**: The system will provide a web-based API for users to request a real-time backlog scan on demand. The system should:
	* Authenticate users to ensure security.
	* Limit the number of requests per user and IP address to prevent abuse.
	* Log requests for auditing and performance tracking.
	* Store previous scans for recovery in cases of system failures or intentional deletion.

5. **Scheduled Scan**: The system will automatically run a backlog scan on a scheduled basis, such as weekly or monthly, to ensure that new projects or opportunities are identified in a timely manner. The system should provide alerts or notifications when new projects or opportunities are identified in real-time.

## 5. Acceptance Criteria

1. **On-Demand Request**: A user can request a backlog scan on demand by invoking the web-based API. The system responds within 1 minute with the scan result displayed in a user-friendly format. The response includes a unique scan ID, which can be used for tracking and auditing purposes.

2. **Scheduled Scan**: A backlog scan is automatically triggered according to the scheduled basis (e.g., weekly or monthly). The system logs each scan, including the date and time of execution, as well as any identified projects or opportunities. The system notifies the relevant stakeholders (e.g., Product Owner, Program Manager) when a new project or opportunity is identified during a scheduled scan.

3. **Data Integration**: The system correctly integrates with the project management tools (e.g., Jira, Trello) to access the backlog data. The system supports data import and export formats such as JSON or XML. The data in the backlog scan results is consistent with the data stored in the project management tools.

## Out of Scope

The automated backlog scan system is not intended to provide features such as:

1. **Real-time Collaboration**: The system does not provide features to collaborate with other team members or enable feedback on identified projects or opportunities.
2. **Advance Search**: The system does not perform advance searches in the backlog data for projects or opportunities based on user-defined criteria.

## Gap Awareness (assigned to builderforce.ai Board)

Below are gaps and implementation chunks that BuilderForce does not provide out of the box. They are not addressed in this PRD for BuilderForce's core runtime, but are needed to deliver the full backlog scanner outlined above.

- BuilderForce does not retrieve Jira/Trello backlogs or a canonical external work-item store.
- BuilderForce does not implement scheduling/alerting/notifications for periodic scans.
- Jira/Trello adapters and aggregate/identification algorithms are not present; this PRD recognizes them as external integration work.

To deliver this feature end-to-end, PRD packages should later be created for:
- A Jira connector (read/write backlogs).
- A Trello connector (read/create backlogs/boards).
- A BuilderForce worker/API surface for periodic scan orchestration and scheduling.
- An external work-item store (weave) and unified ETL layer to normalize work items.
- An identification heuristic (keyword/tag/machine learning) and scan scoring.

This PRD defines scope and behaviors, but points to an external implementation effort (EPIC on the builderforce.ai board).

---

## Implementation Assignments

### Assigned Gap EPIC
- EPIC #345-AUTOBACKLOG: Build missing backlog-scan functional chunks for BuilderForce.ai (scheduled scan, notifications, scheduling worker) and define shape for integrator adapters. Assignee to scope subwork as Jira/Trello plug-ins + external weave store strategy.

### Pending Packages (to be authored separately)
- Package #345-EI-JIRA: Jira connector – read/write backlogs; JSON/XML export.
- Package #345-EI-TRELLO: Trello connector – read boards/backlogs; JSON/XML export.
- Package #345-SCSW-BUILDERFORCE: BuilderForce worker for scheduled scan orchestration; audit logging; recoverable scan state; webhook-driven scheduling.
- Package #345-INF-WEAVE: External work-item store schema (named weave) and ETL normalizer; support for merging/identifying projects from disparate sources.
- Package #345-SVC-SCANORCHESTRATOR: Scan orchestrator – craft identification heuristics; persistence with retry; telemetry; permission enforcement.

Prerequisites:

The system will be developed using the following tools and technologies:

1. **Project Management Tools**: Jira, Trello, or other project management tools with API support.
2. **Programming Languages**: Python, Java, or other suitable languages.
3. **Databases**: SQL or NoSQL databases with data storage and retrieval capabilities.
4. **Web Framework**: Django, Flask, or other web frameworks that support RESTful APIs.

---

> **PRD** — drafted by Ada (Sr. Product Mgr) · task #470
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: README.md Restoration & Avatar Filter Documentation

## 1. Problem & Goal

**Problem:** The current `README.md` is incomplete, containing only a specific feature blurb (avatar filter) and lacking the comprehensive project documentation. This hinders new user onboarding, project understanding, and effective collaboration.

**Goal:** Restore the `README.md` to its full, original project documentation state, ensuring it provides a complete overview of the project. Concurrently, integrate the avatar filter feature documentation into a logical section of the restored `README.md`.

## 2. Target Users / ICP Roles

*   **New Users/Developers:** Individuals exploring the project for the first time, needing quick setup and usage instructions.
*   **Existing Contributors:** Developers seeking project context, contribution guidelines, or specific feature details.
*   **Project Maintainers:** Stakeholders responsible for project clarity and documentation quality.

## 3. Scope

This task focuses solely on the modification and content update of the `README.md` file within the repository.

## 4. Functional Requirements

*   **FR1: Restore Original Project Content:** The `README.md` file MUST be updated to include all the core project documentation that existed prior to the current avatar-filter-only state. This includes, but is not limited to, project description, installation instructions, usage examples, contribution guidelines, and licensing information.
*   **FR2: Integrate Avatar Filter Section:** A dedicated section detailing the "Avatar Filter" feature MUST be added to the `README.md`.
    *   **FR2.1: Content:** This section MUST clearly describe the purpose, functionality, and usage (including any configuration or examples) of the avatar filter.
*   **FR3: Logical Content Organization:** The restored project content and the new "Avatar Filter" section MUST be logically structured and presented within the `README.md` to ensure readability and ease of navigation. The avatar filter section can be appended to an existing "Features" or "Documentation" area, or placed in a newly created, appropriate section.
*   **FR4: Markdown Compliance:** All content MUST adhere to GitHub-flavored Markdown syntax for correct rendering.

## 5. Acceptance Criteria

*   The `README.md` file exists and has been updated.
*   The `README.md` file contains all essential project-level information (e.g., project title, description, installation, usage, contributing, license) as per the original project documentation.
*   A clearly titled "Avatar Filter" section is present within the `README.md`.
*   The "Avatar Filter" section accurately explains what the feature does and how to use it.
*   The overall structure of the `README.md` is logical, coherent, and easy to read.
*   All markdown formatting renders correctly on GitHub.
*   There are no placeholder texts or incomplete sections within the final `README.md`.

## 6. Out of Scope

*   Creating or updating documentation for any other project features not explicitly mentioned.
*   Refactoring or re-writing existing project documentation content beyond what is necessary to integrate the avatar filter section smoothly.
*   Changes to any source code files.
*   Changes to any files other than `README.md`.
*   Updating the functionality of the avatar filter itself.
