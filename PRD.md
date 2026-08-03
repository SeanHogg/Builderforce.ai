> **PRD** — drafted by Ada (Sr. Product Mgr) · task #620
> _Each agent that updates this PRD signs its change below._

# Diagnostic Report Epic

## Problem & Goal

### Problem
- The current system lacks a comprehensive diagnostic report feature, making it difficult for users to identify and troubleshoot issues effectively.
- The progress percentage indicator shows 100% completion for reports that have not been fully processed, leading to confusion and potential misuse of the data.
- The absence of a dedicated `diagnosticReport.ts` and `ReportDashboard.tsx` file or their trivial implementation hinders the development of a robust diagnostic reporting system.

### Goal
- Develop a comprehensive diagnostic report feature that accurately reflects the processing status of reports.
- Implement `diagnosticReport.ts` and `ReportDashboard.tsx` with non-trivial functionalities to support the diagnostic reporting system.
- Ensure the progress percentage accurately represents the actual state of report generation.

## Target Users / ICP Roles
- **System Administrators**: Responsible for monitoring system health and troubleshooting issues.
- **Data Analysts**: Need detailed reports to analyze system performance and data integrity.
- **Developers**: Require access to diagnostic data for debugging and system optimization.

## Scope

### In Scope
- **Diagnostic Report Generation**: Create a system to generate detailed diagnostic reports.
- **Progress Percentage Accuracy**: Update the progress percentage calculation to reflect the actual state of report generation.
- **Report Dashboard**: Develop a dashboard to display diagnostic reports with filtering and sorting capabilities.
- **File Implementation**: Implement `diagnosticReport.ts` and `ReportDashboard.tsx` with non-trivial functionalities.
- **User Interface**: Design a user-friendly interface for viewing and interacting with diagnostic reports.

### Out of Scope
- **Historical Data Analysis**: The system will not include features for analyzing historical diagnostic data.
- **Automated Issue Resolution**: The feature will not automatically resolve issues identified in the diagnostic reports.
- **Third-Party Integrations**: Integration with third-party diagnostic tools or services is not included in this scope.
- **Advanced Reporting Features**: Features such as exporting reports to PDF or Excel reports are not part of this release.

## Functional Requirements

1. **Diagnostic Report Generation**
   - The system must generate diagnostic reports upon request or at scheduled intervals.
   - Reports must include system performance metrics, error logs, and data integrity checks.

2. **Progress Percentage Calculation**
   - The progress percentage must be calculated based on the actual state of report generation.
   - The system must update the progress percentage in real-time as the report is being generated.

3. **Report Dashboard**
   - The dashboard must display a list of generated diagnostic reports.
   - Users must be able to filter and sort reports based on various criteria (e.g., date, severity, type).
   - The dashboard must provide a summary view of key metrics and allow users to drill down into detailed report data.

4. **User Interface**
   - The UI must be intuitive and responsive, providing a seamless experience for users.
   - Users must be able to view, download, and share diagnostic reports directly from the dashboard.

5. **File Implementation**
   - `diagnosticReport.ts` must contain the logic for generating and processing diagnostic reports.
   - `ReportDashboard.tsx` must contain the UI components and logic for displaying the report dashboard.

## Acceptance Criteria

1. **Diagnostic Report Generation**
   - Reports are generated accurately and include all required data.
   - Reports are accessible via the dashboard and can be downloaded in a standard format.

2. **Progress Percentage Calculation**
   - The progress percentage accurately reflects the state of report generation.
   - The progress indicator updates in real-time without lag.

3. **Report Dashboard**
   - The dashboard displays a list of reports with appropriate filtering and sorting options.
   - Users can view summary metrics and access detailed report data.

4. **User Interface**
   - The UI is intuitive and responsive, with no major usability issues.
   - Reports can be viewed, downloaded, and shared without errors.

5. **File Implementation**
   - `diagnosticReport.ts` and `ReportDashboard.tsx` are implemented with non-trivial functionalities.
   - The code is well-documented and follows best practices.

## Out of Scope

- Historical data analysis features.
- Automated issue resolution capabilities.
- Integration with third-party diagnostic tools.
- Advanced reporting features such as PDF or Excel exports.

## Requirements

### Current State Analysis (Business Analysis)

#### File Existence Verification
| File | Status | Notes |
|------|--------|-------|
| `diagnosticReport.ts` | **DOES NOT EXIST** | No such file found in api/src/domain/ or api/src/application/ |
| `ReportDashboard.tsx` | **DOES NOT EXIST** | No such file found in web-ui/src/ or any frontend directory |

#### Progress Percentage Bug Identified
- **Location**: `api/src/application/project/computeProject360.ts` lines 217-222
- **Issue**: When `hasData` is `false` (0 tasks), the progress dimension is hardcoded to `100`:
  ```typescript
  push('progress', 'Progress', 'delivery', hasData ? progressPct : 100, ...);
  ```
- **Impact**: Empty projects show 100% completion, misleading stakeholders
- **Test Evidence**: `computeProject360.test.ts` line 57 explicitly expects this behavior

#### Database Schema Gap
- No dedicated `diagnostic_reports` table exists in the schema
- Existing "diagnostic" references are limited to LLM tracing, runtime diagnostics, and kanban audit features
- No entity to store generated diagnostic reports

### Functional Requirements

1. **Diagnostic Report Storage (REQ-DR-001)**
   - The system MUST create a `diagnostic_reports` database table to persist report metadata and content
   - Each report MUST have: id, projectId, tenantId, status, progressPct, generatedAt, completedAt, reportData (JSON)
   - Report statuses: `pending`, `processing`, `completed`, `failed`

2. **Progress Calculation Accuracy (REQ-DR-002)**
   - The system MUST calculate progress based on actual work completed vs total work
   - Progress MUST NOT default to 100% when there is no data
   - Empty projects MUST display 0% or "No data" rather than 100%
   - The progress value MUST accurately reflect: completed subtasks / total subtasks

3. **Real-time Progress Updates (REQ-DR-003)**
   - The system MUST update progress percentage as report generation proceeds
   - Progress updates MUST be stored in the database and retrievable via API
   - Frontend MUST poll or subscribe to progress changes

4. **Report Dashboard UI (REQ-DR-004)**
   - The system MUST implement `ReportDashboard.tsx` in the web-ui
   - Dashboard MUST display a list of all diagnostic reports for the tenant/project
   - Dashboard MUST support filtering by: status, date range, severity
   - Dashboard MUST support sorting by: date, progress, project name

5. **Report Generation Logic (REQ-DR-005)**
   - The system MUST implement `diagnosticReport.ts` in api/src/domain/
   - Must include: system metrics collection, error log aggregation, data integrity checks
   - Must support both on-demand and scheduled report generation

6. **Report Viewing & Export (REQ-DR-006)**
   - Users MUST be able to view full report details from the dashboard
   - Reports MUST be downloadable in JSON format
   - Report sharing via unique URL MUST be supported

### Non-Functional Requirements

- **Performance**: Report generation should not block the main application
- **Scalability**: System must handle 1000+ reports per tenant
- **Security**: Report access must be restricted to authorized users (tenant isolation)

### Acceptance Criteria for Requirements

- [ ] `diagnosticReport.ts` exists with non-trivial implementation (>100 LOC, not a stub)
- [ ] `ReportDashboard.tsx` exists with non-trivial implementation (>150 LOC, not a stub)
- [ ] Progress percentage shows 0% for empty projects, not 100%
- [ ] Database schema includes `diagnostic_reports` table
- [ ] Reports can be created, listed, viewed, and downloaded

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._