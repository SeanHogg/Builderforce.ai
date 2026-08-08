> **PRD** — drafted by Ada (Sr. Product Mgr) · task #638
> _Each agent that updates this PRD signs its change below._

# Cross-Project Health Dashboard PRD

## Problem & Goal

### Problem
- **Lack of Visibility**: Project managers and stakeholders lack a unified view of the health and status of multiple projects.
- **Inefficient Monitoring**: Current tools require manual aggregation of data from different projects, leading to inefficiencies and potential errors.
- **Delayed Decision-Making**: Without real-time insights, decision-making is delayed, impacting project timelines and resource allocation.

### Goal
- **Unified Dashboard**: Develop a cross-project health dashboard that provides a real-time, unified view of multiple projects.
- **Enhanced Monitoring**: Enable efficient monitoring and tracking of project health metrics.
- **Improved Decision-Making**: Facilitate data-driven decision-making by providing actionable insights.

## Target Users / ICP Roles

- **Project Managers**: Responsible for overseeing multiple projects and ensuring they are on track.
- **Program Managers**: Overseeing a portfolio of projects and ensuring alignment with organizational goals.
- **Stakeholders**: Individuals who need to understand the overall health of projects to make strategic decisions.
- **Team Leads**: Leaders who need to monitor the status of their team’s contributions across various projects.

## Scope

### In-Scope
- **Dashboard Interface**: A user-friendly interface that displays key health metrics for multiple projects.
- **Data Aggregation**: Automatic aggregation of data from various project management tools and repositories.
- **Real-Time Updates**: Real-time updates of project metrics and status.
- **Customizable Views**: Ability for users to customize the dashboard to display metrics relevant to their role.
- **Alerts and Notifications**: Configurable alerts for critical changes in project health.
- **Reporting**: Exportable reports for stakeholders and management reviews.

### Out-of-Scope
- **Integration with All Tools**: Integration with every possible project management and development tool (initial focus will be on Jira, GitHub, and Jenkins).
- **Advanced Analytics**: Complex data analytics and predictive modeling (future enhancement).
- **Mobile App**: A dedicated mobile application (dashboard will be web-based).
- **Historical Data Analysis**: In-depth analysis of historical data beyond 12 months (initial focus will be on current and recent data).

## Functional Requirements

1. **Data Ingestion**
   - Connect and ingest data from Jira, GitHub, and Jenkins.
   - Support for additional tools via plugins or APIs in future releases.

2. **Dashboard Features**
   - Display key metrics such as project status, progress, issues, and risks.
   - Visual indicators (e.g., traffic lights, charts) for quick assessment.
   - Drill-down capability to view detailed information for each project.

3. **Customization**
   - User-specific dashboards with customizable widgets.
   - Ability to set up personalized alerts and notifications.

4. **Reporting**
   - Generate and export reports in PDF and Excel formats.
   - Schedule automated reports for regular distribution.

5. **Security**
   - Role-based access control (RBAC) to ensure users only see relevant data.
   - Secure data transmission and storage in compliance with industry standards.

6. **Performance**
   - Responsive design for seamless user experience across devices.
   - Optimize for fast loading times and efficient data processing.

## Acceptance Criteria

- **Data Accuracy**: Dashboard must accurately reflect the latest data from integrated tools.
- **User Interface**: Interface must be intuitive and responsive, with no major usability issues reported by beta testers.
- **Performance**: Dashboard must load within 2 seconds for users with standard internet connections.
- **Security**: No security vulnerabilities identified during penetration testing.
- **Customization**: Users must be able to customize their dashboards and receive notifications based on their preferences.
- **Reporting**: Export functionality must generate accurate and well-formatted reports.

## Out of Scope

- **Integration with Non-Standard Tools**: Integration with tools not listed in the functional requirements.
- **Machine Learning Features**: Implementation of machine learning algorithms for predictive analytics.
- **Multi-Language Support**: Support for languages other than English.
- **Offline Access**: Ability to access the dashboard without an internet connection.
- **Third-Party Authentication**: Support for authentication via third-party services beyond OAuth.

## Requirements

### Technical Requirements

1. **Frontend Architecture**
   - React-based dashboard component using TypeScript
   - Client-side rendering with `'use client'` directive
   - Responsive design supporting desktop-first with mobile-friendly font sizing
   - CSS-in-JS approach using inline styles for portability

2. **Data Model**
   - `ProjectHealth` interface containing: id, name, status, completionPct, taskSummary, keyBlocker, riskLevel, riskRationale, recommendedAction, and optional extras
   - `PortfolioSummary` interface containing: generatedAt, totalProjects, greenCount, amberCount, redCount, overall, and topPriorityActions
   - `RAG` type: 'Green' | 'Amber' | 'Red'
   - `ProjectStatus` type: 'Active' | 'On Hold' | 'Paused'
   - `RiskLevel` type: 'Low' | 'Medium' | 'High'

3. **RAG Status Derivation (FR-3)**
   - 🟢 Green: Active status, >50% complete, no build failures, no stalled tasks
   - 🟡 Amber: Active with known blockers OR on hold with defined plan OR 25–50% complete with risks
   - 🔴 Red: Build broken, 0% complete with active status, no tasks defined, or stalled with no DRI
   - Manual RAG overrides must be respected when present

4. **Component Structure**
   - Main `CrossProjectHealthDashboard` component
   - `ProjectCard` sub-component for individual project display
   - `PortfolioSummary` sub-component for portfolio-level metrics
   - Separate data module (`portfolioHealthData.tsx`) for business logic

### Data Requirements

1. **Project Data Fields**
   - Unique identifier (id)
   - Project name
   - Status (Active/On Hold/Paused)
   - Completion percentage (nullable)
   - Task summary text
   - Key blocker description
   - Risk level assessment
   - Risk rationale
   - Recommended action
   - Optional extras (OKR epics, failing tests, task counts)

2. **Portfolio Aggregation**
   - Count of Green/Amber/Red projects
   - Overall portfolio health (worst-case derivation)
   - Top 3 priority actions ranked by impact
   - Timestamp of data generation

### Integration Requirements

1. **Data Ingestion**
   - Initial implementation uses static snapshot data
   - Data module must be swappable for API fetch in future releases
   - No direct I/O or global side effects in data layer
   - Support for ISO-8601 timestamps

2. **Future API Integration**
   - API endpoint to fetch real-time project health data
   - ReactQuery or similar for data fetching and caching
   - Refresh options for manual and automatic updates

### Performance Requirements

1. **Loading Performance**
   - Dashboard must load within 2 seconds (per Acceptance Criteria)
   - Point-in-time snapshot display shows generatedAt timestamp
   - Efficient rendering with React component memoization

2. **Scannability (FR-6)**
   - Summary information above the fold
   - RAG color prominently displayed as badge
   - Project cards scannable in ≤30 seconds total
   - Desktop-first layout with mobile-friendly font sizing

### Security Requirements

1. **Data Display**
   - Role-based access control to ensure users only see authorized projects
   - No sensitive data exposed in dashboard cards
   - Secure data transmission for any API calls

### Accessibility Requirements

1. **ARIA Support**
   - Proper ARIA labels on interactive elements
   - Semantic HTML structure (main, section, heading elements)
   - Color-blind friendly RAG indicators (emojis alongside colors)
   - Screen reader compatible status announcements

### Data Update Requirements

1. **Maintenance**
   - Update project data once per sprint or when significant changes occur
   - RAG status auto-computes via `deriveRagStatus` function
   - Manual overrides only when policy requires short-circuiting automatic derivation

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._