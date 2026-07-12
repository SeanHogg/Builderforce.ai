> **PRD** — drafted by Ada (Sr. Product Mgr) · task #504
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Stakeholder Map Configuration and Store

## 1. Problem & Goal

### 1.1 Problem Statement
Currently, there is no standardized or centralized mechanism within the platform to define and manage required approvers and informed parties for specific initiatives. This lack of clear stakeholder identification can lead to missed approvals, inefficient communication, and uncertainty regarding accountability, potentially delaying initiative progress and increasing operational overhead.

### 1.2 Goal
To implement a robust system that allows Product Managers to define, store, and manage stakeholder maps (comprising required approvers and informed parties) for each initiative. This system will provide a lightweight, dedicated data store, a secure CRUD API for updates without duplicating external prospectus data, and ensure visibility of these maps to all team members within the application, with role-based editing restrictions.

## 2. Target Users / ICP Roles

*   **Product Managers (PMs):** Primary users responsible for creating, updating, and managing stakeholder maps for their initiatives.
*   **All Team Members (Developers, Designers, QAs, etc.):** Viewers of stakeholder maps to understand initiative dependencies and communication channels.
*   **System Integrators / Developers:** Consumers of the Stakeholder Map CRUD API for programmatically interacting with stakeholder data.

## 3. Scope

This project encompasses the design, development, and implementation of:

*   A data schema for defining stakeholder maps, including required approvers and informed parties per initiative.
*   A lightweight, dedicated data store for stakeholder maps.
*   A secure and performant CRUD (Create, Read, Update, Delete) API for managing stakeholder maps.
*   API functionality to update maps without duplicating external prospectus data (e.g., referencing user IDs instead of full profiles).
*   API functionality supporting `projectId` or `initiativeId`-loose matching for retrieval.
*   Application-level visibility of stakeholder maps to all authenticated team members.
*   Role-based access controls to restrict editing capabilities exclusively to Product Managers.
*   Required Data Transfer Objects (DTOs) for listing and updating stakeholder maps.
*   Comprehensive OpenAPI documentation for all API endpoints.

## 4. Functional Requirements

*   **FR.1: Stakeholder Definition:** The system shall allow defining a list of required approvers and a list of informed parties for each unique initiative.
*   **FR.2: Data Storage:** The system shall provide a dedicated and lightweight store for stakeholder maps, associated with initiatives.
*   **FR.3: CRUD API:** The system shall expose a RESTful API for creating, reading, updating, and deleting stakeholder maps.
*   **FR.4: Non-Duplication:** The API shall support updating stakeholder maps using references (e.g., user IDs) to avoid duplicating external prospectus data (e.g., full user profiles).
*   **FR.5: Flexible Retrieval:** The API for retrieving stakeholder maps shall support "loose matching" by either `projectId` or `initiativeId`.
*   **FR.6: Application Visibility:** Stakeholder maps shall be visible to all authenticated team members within the main application UI.
*   **FR.7: PM Editing:** Product Managers shall be able to create, edit, and delete stakeholder maps via the application UI and API.
*   **FR.8: Role-Based Editing Restriction:** Editing capabilities for stakeholder maps shall be restricted to users with the "Product Manager" role; other roles shall have read-only access.
*   **FR.9: Stakeholder Map Schema:** A formal schema definition for the stakeholder map data structure shall be provided.
*   **FR.10: DTOs:** Specific Data Transfer Objects (DTOs) for listing multiple stakeholder maps and for updating a single stakeholder map shall be defined and utilized by the API.
*   **FR.11: API Documentation:** Comprehensive OpenAPI documentation shall be provided for all stakeholder map API endpoints, including request/response schemas.

## 5. Acceptance Criteria

*   **AC.1:** An API endpoint exists and functions correctly to create a new stakeholder map for a given `initiativeId`, specifying lists of `approverIds` and `informedPartyIds`.
*   **AC.2:** An API endpoint exists and functions correctly to retrieve a stakeholder map by `initiativeId`. The endpoint also supports retrieval by `projectId` (if multiple initiatives can map to a project, it should return relevant maps).
*   **AC.3:** An API endpoint exists and functions correctly to update an existing stakeholder map for a given `initiativeId`, modifying its `approverIds` and `informedPartyIds`.
*   **AC.4:** An API endpoint exists and functions correctly to delete a stakeholder map by `initiativeId`.
*   **AC.5:** The stakeholder map schema is formally defined (e.g., as a JSON Schema) and covers `initiativeId`, `projectId` (optional), `approverIds[]`, and `informedPartyIds[]`.
*   **AC.6:** The defined Stakeholder Map List DTO correctly represents a collection of stakeholder maps for API responses.
*   **AC.7:** The defined Stakeholder Map Update DTO correctly represents the fields permitted for updates via the API.
*   **AC.8:** All authenticated users can navigate to an initiative within the application UI and view its associated stakeholder map, including the lists of approvers and informed parties.
*   **AC.9:** Only users assigned the "Product Manager" role can access the UI elements and API endpoints for creating, updating, or deleting stakeholder maps. Attempts by other roles will result in an authorization error (e.g., 403 Forbidden).
*   **AC.10:** The OpenAPI specification clearly documents all stakeholder map API endpoints, their request/response formats, authentication requirements, and error codes.

## 6. Out of Scope

*   Detailed user profile management (assumed to be handled by an existing identity or user management service).
*   Advanced workflow or approval logic beyond defining roles (e.g., sequential approvals, approval tracking status).
*   Notification mechanisms (e.g., emails to approvers/informed parties when an initiative starts or requires approval).
*   UI for editing or viewing external prospectus data directly within this feature.
*   Complex querying of stakeholder maps based on user attributes (e.g., finding all initiatives where user X is an approver across all projects).
*   Data migration of existing, unstandardized stakeholder information.