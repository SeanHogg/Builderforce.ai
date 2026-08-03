> **PRD** — drafted by Ada (Sr. Product Mgr) · task #563
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Enumerate All Sandbox Environments and Their Configured Egress Rules

## Problem & Goal
**Problem:**  
Platform administrators, security engineers, and DevOps teams lack a single-pane view of all sandbox environments and their egress rules. Egress rules are scattered across environment-specific configurations, making audits, troubleshooting, and compliance checks time-consuming and error-prone. This fragmentation leads to security blind spots, accidental misconfigurations, and delayed incident response.

**Goal:**  
Provide a centralized, read-only capability to enumerate all sandbox environments along with their configured egress rules. This enables rapid visibility, auditability, and compliance verification without requiring manual aggregation or direct access to each environment’s configuration store.

## Target Users / ICP Roles
- **Platform Administrators** – Need to oversee all sandbox environments and ensure network policies are consistent.
- **Security Engineers** – Audit egress rules to validate that no overly permissive rules exist and that sandboxes are isolated appropriately.
- **DevOps/SRE Engineers** – Troubleshoot connectivity issues in sandbox environments by quickly checking allowed outbound traffic.
- **Compliance Officers** – Verify that egress rules align with regulatory requirements (e.g., data residency, network segmentation).

## Scope
- **In Scope:**
  - Provide a dedicated API endpoint (`GET /sandboxes/egress-rules`) that returns a list of all sandbox environments.
  - For each environment, include environment metadata (id, name, region, type, status) and its currently active egress rules.
  - Each egress rule must include: rule ID, description, source (CIDR/service), destination (CIDR/FQDN), protocol, port range, and action (ALLOW/DENY).
  - Support filtering by environment attributes (id, name, region, type) and egress rule properties (destination, action) via query parameters.
  - Implement a UI view (sandbox listing page) that displays the same information in a sortable, filterable table.
  - Ensure read-only access; no ability to create, modify, or delete egress rules from this feature.
  - Enforce role-based access control (RBAC); only users with sandbox read permissions can access the data.

## Functional Requirements
- **FR1:** An API endpoint `GET /api/v1/sandboxes/egress-rules` shall return a JSON array of sandbox objects. Each sandbox object contains:
  - `sandboxId`, `name`, `region`, `type`, `status`
  - `egressRules`: array of objects with fields `ruleId`, `description`, `sourceCidr`, `destination`, `protocol`, `portRange`, `action`.
- **FR2:** The endpoint shall accept optional query parameters for filtering: `sandboxId`, `name`, `region`, `type`, `destination` (partial match), `action` (ALLOW/DENY). Multiple filters are combined with AND logic.
- **FR3:** The endpoint shall support pagination (`pageSize`, `pageToken`) and sorting (`sortBy`, `sortOrder`).
- **FR4:** The UI shall present a table with columns: Sandbox Name, Region, Type, Status, Rule Count. Clicking a row expands to show detailed egress rules in a sub-table.
- **FR5:** The UI shall provide a top-level filter bar that mirrors the API filtering capabilities.
- **FR6:** All responses must be consistent with the platform’s authentication and authorization model. Only users with `sandbox:read` scope can access the data.
- **FR7:** The system must retrieve egress rules from the authoritative source of truth (e.g., network policy store, infrastructure-as-code repository) and reflect the current state within a maximum staleness of 5 minutes.

## Acceptance Criteria
- **AC1:** Given at least one sandbox environment with egress rules, when a GET request is made to the API without filters, the response includes that environment and its rules correctly formatted.
- **AC2:** When filtering by `region=us-east-1`, the API returns only sandboxes in that region, and their egress rules are still accurate.
- **AC3:** When a user without `sandbox:read` permission calls the API, a 403 Forbidden response is returned.
- **AC4:** The UI table loads within 2 seconds for up to 100 sandboxes, and the expandable sub-table shows rule details without reloading the page.
- **AC5:** Filtering in the UI updates the table in real-time and reflects the same results as the API for the same parameters.
- **AC6:** Pagination works correctly; navigating to the next page shows the next set of results, and the previous page retains the previous results.
- **AC7:** When a sandbox has no egress rules defined, the `egressRules` array is empty, and the UI shows “No rules configured” in the expanded view.

## Out of Scope
- Creating, updating, or deleting egress rules (this is a read-only enumeration feature).
- Real-time monitoring or alerting on egress traffic.
- Support for non-sandbox environments (e.g., production, staging).
- Historical change logs or audit trails of egress rule modifications.
- Visualization of egress rules as topology diagrams.
- Integration with external CMDB or SIEM tools in this phase.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._