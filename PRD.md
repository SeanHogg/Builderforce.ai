> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1628
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD) - GAP-G2 Closure Visibility - Wrong Repository

## Problem & Goal

### Problem
The current GAP-G2 gap tracking system lacks visibility into closure status when tasks are incorrectly assigned to the wrong repository. This misalignment leads to:
- Inefficient tracking of security/compliance gaps.
- Miscommunication and delays in gap closure.
- Increased risk due to unresolved security/compliance issues.

### Goal
Provide clear visibility and actionable insights into GAP-G2 closure status when tasks are assigned to the wrong repository. Ensure that stakeholders can promptly identify and rectify misassigned tasks to maintain the integrity of the security/compliance gap tracking process.

## Target Users / ICP Roles
- **Security Analysts**: Responsible for tracking and closing security/compliance gaps.
- **Compliance Officers**: Ensure adherence to security policies and standards.
- **Project Managers**: Oversee the progress of gap closure activities.
- **Developers**: Implement fixes for identified security/compliance gaps.

## Scope
- **Dashboard Integration**: Enhance the existing Security Provisioning Dashboard to include GAP-G2 closure visibility for misassigned tasks.
- **Repository Mismatch Detection**: Implement a mechanism to detect when a task is assigned to an incorrect repository.
- **Notification System**: Provide real-time notifications to relevant stakeholders when a repository mismatch is detected.
- **Reporting**: Generate reports on misassigned tasks and their impact on gap closure timelines.
- **User Interface Enhancements**: Update the user interface to display closure status and repository mismatch information prominently.

## Functional Requirements

1. **Repository Mismatch Detection**
   - Automatically identify when a GAP-G2 task is assigned to an incorrect repository based on predefined criteria.
   - Alert users when a mismatch is detected.

2. **Dashboard Integration**
   - Display closure status for GAP-G2 tasks, including those with repository mismatches.
   - Provide a visual indicator for tasks with repository mismatches (e.g., red flag or icon).

3. **Notification System**
   - Send real-time notifications to Security Analysts and Compliance Officers when a repository mismatch is detected.
   - Include details of the mismatch and its potential impact on gap closure.

4. **Reporting**
   - Generate weekly/monthly reports on the number of repository mismatches and their resolution status.
   - Include trend analysis to identify patterns or recurring issues.

5. **User Interface Enhancements**
   - Update the Security Provisioning Dashboard to include a dedicated section for repository mismatch insights.
   - Allow users to filter and sort tasks based on closure status and repository mismatch status.

## Acceptance Criteria

- The Security Provisioning Dashboard accurately reflects the closure status of GAP-G2 tasks, including those with repository mismatches.
- Users receive timely notifications when a repository mismatch is detected.
- Reports generated include accurate and actionable data on repository mismatches.
- The user interface provides clear and intuitive visibility into repository mismatch status and closure progress.
- Stakeholders can easily identify and address repository mismatches through the dashboard.

## Out of Scope

- **Automated Task Reassignment**: The system will not automatically reassign tasks to the correct repository.
- **Historical Data Migration**: Migrating historical data on repository mismatches is not included in this release.
- **Third-Party Integrations**: Integration with third-party tools for repository management is not part of this scope.
- **Advanced Analytics**: Implementing machine learning or advanced analytics for predicting repository mismatches is out of scope.
- **User Training**: Development of training materials or user training sessions is not included.

## Requirements

### Business Analyst Assessment — Domain Mismatch Identified

**Critical Finding:** This PRD describes a "Security Provisioning Dashboard" with GAP-G2 gap tracking for security/compliance gaps. The bound repository (seanhogg/builderforce.ai) is an AI dev-workforce platform that does **NOT** contain a Security Provisioning Dashboard or a GAP-G2 gap tracking system.

#### What Exists in This Repository
- **Cross-Project Health Dashboard**: Portfolio-level health tracking (BuilderForce.AI, Hired.Video, RumbleDating, BurnRateOS, pattysnob.com) with RAG status, completion metrics, and blocker identification
- **Security Agent**: A SOC 2 audit agent (migration 0291) that runs audits across five Trust Service Criteria and creates SECURITY-typed task findings
- **Security Infrastructure**: `api/src/application/security/` contains SecurityAuditService, SecurityReviewService, SecurityTicketAccessService, GitHub alerts integration, and web security scanning

#### What Does NOT Exist in This Repository
- **Security Provisioning Dashboard**: No dashboard exists for security/compliance provisioning
- **GAP-G2 Gap Tracking System**: No system tracks "GAP-G2" as a gap closure item (GAP-G2 in specs/builderforce/09-prd-cloud-agent-validation.md refers to a cloud agent security validation gap, not a user-facing gap tracking system)
- **Repository Mismatch Detection**: No mechanism to detect when tasks are assigned to the wrong repository in a security/compliance context

#### Recommended Actions
1. **Re-scope for this repository**: If GAP-G2 closure visibility is to be implemented here, it would need to leverage the existing Security Agent infrastructure and Cross-Project Health Dashboard as the foundation
2. **Alternative**: Bind to the correct security/compliance platform repository where the Security Provisioning Dashboard actually exists

### Functional Requirements (for context, subject to domain clarification)

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| REQ-01 | Repository mismatch detection for security tasks | P0 | Requires security task taxonomy + repo mapping |
| REQ-02 | Dashboard integration showing closure status | P0 | Could extend Cross-Project Health Dashboard |
| REQ-03 | Real-time notifications on mismatch | P1 | Leverage existing notification infrastructure |
| REQ-04 | Reporting on mismatches and resolution | P2 | Weekly/monthly report generation |
| REQ-05 | UI enhancements for visibility | P1 | Filter/sort by mismatch status |

### Data Requirements
- Security task entity with repository association
- Repository mapping configuration
- Mismatch detection rules/logic
- Audit trail for mismatch notifications

### Integration Points
- Security Agent (api/src/application/security/)
- Cross-Project Health Dashboard
- Notification service
- Existing task/board infrastructure

---

_Signed: business-analyst, task #1628_

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._