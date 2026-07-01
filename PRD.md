> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #170
> _Each agent that updates this PRD signs its change below._

## Product Requirements Document: Endpoint & Route Catalog

### Problem & Goal

**Problem:** There is a lack of centralized, up-to-date visibility into all existing API endpoints and frontend routes across our systems. This leads to:
*   Duplication of effort and inconsistent implementations.
*   Challenges in onboarding new engineers and understanding system architecture.
*   Potential security vulnerabilities due to unmanaged or forgotten endpoints.
*   Difficulties in impact analysis for system changes and refactoring.

**Goal:** Create a comprehensive, searchable catalog of all active API endpoints (REST, GraphQL) and frontend routes across all services and applications. This will improve development efficiency, enhance security posture, and foster better architectural understanding.

### Target Users / ICP Roles

*   **Software Engineers (Backend, Frontend, Full-stack):** For discovering existing functionality, ensuring consistency, and understanding architectural boundaries.
*   **QA Engineers:** For test planning and coverage analysis.
*   **Security Engineers:** For identifying potential attack surfaces and ensuring adherence to security policies.
*   **Architects:** For maintaining a clear view of the system landscape and planning future developments.
*   **Product Managers:** For understanding current capabilities and identifying areas for enhancement or consolidation.

### Scope

This initiative encompasses the identification, collection, and storage of metadata for:
1.  All active REST API endpoints across all backend services.
2.  All active GraphQL API endpoints and their associated queries/mutations.
3.  All active frontend routes/pages across all web and mobile applications.
4.  The creation of a centralized, queryable data store for this information.

### Functional Requirements

*   **FR1: Endpoint & Route Discovery:** The system must automatically or semi-automatically discover API endpoints and frontend routes from codebases, configuration files, or existing OpenAPI/Swagger specifications.
    *   *Support:* Node.js (Express, NestJS), Python (Flask, Django), Java (Spring Boot), React, Angular, Vue.js, etc.
*   **FR2: Data Capture - API Endpoints:** For each API endpoint, the following minimum data points must be captured:
    *   HTTP Method (GET, POST, PUT, DELETE, PATCH)
    *   Path
    *   Service Name
    *   Description (if available)
    *   Authentication/Authorization requirements (e.g., "auth required", "admin only")
    *   Owner/Team
    *   Last updated timestamp
*   **FR3: Data Capture - Frontend Routes:** For each frontend route, the following minimum data points must be captured:
    *   Path
    *   Application Name (e.g., "Web Portal", "Mobile App")
    *   Associated Component/Page Name
    *   Description (if available)
    *   Authentication/Authorization requirements
    *   Owner/Team
    *   Last updated timestamp
*   **FR4: Centralized Data Storage:** All cataloged data must be stored in a persistent, indexed, and queryable database or data store.
*   **FR5: User Interface & API:** Provide a web-based user interface for browsing, searching, and filtering catalog entries. An API should also be available for programmatic access.
*   **FR6: Regular Updates:** Implement a mechanism for periodic updates to ensure the catalog remains current as endpoints/routes are added, modified, or removed from source code.

### Acceptance Criteria

*   **AC1:** 100% of currently active REST API endpoints across all services are cataloged with FR2 data points.
*   **AC2:** 100% of currently active GraphQL API endpoints are cataloged with FR2 data points (GraphQL specifics like query/mutation names instead of HTTP method).
*   **AC3:** 100% of currently active frontend routes across all applications are cataloged with FR3 data points.
*   **AC4:** The catalog is accessible via the web UI and API (FR5).
*   **AC5:** Users can search and filter catalog entries by Service Name, Application Name, Path, Owner, and Authentication/Authorization requirements.
*   **AC6:** A new endpoint/route is reflected in the catalog within 24 hours of being deployed to production.
*   **AC7:** Changes to existing cataloged entries (e.g., path update, new description) are reflected within 24 hours of deployment.

### Out of Scope

*   Detailed performance metrics (e.g., latency, throughput) for endpoints.
*   Automated generation of OpenAPI/Swagger specifications (unless purely a byproduct of the discovery process).
*   Automated testing or validation of endpoints/routes based on catalog data.
*   Real-time traffic analysis or log aggregation beyond what's needed for initial discovery.
*   Automated deprecation or removal of unused endpoints/routes.
*   Cataloging internal function calls or RPCs not exposed as public API endpoints.
*   Enforcement of authentication or authorization rules; the catalog only documents these requirements.