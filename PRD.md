> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #172
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: User Profile Management API

## 1. Problem & Goal

**Problem:** Current user profile information is fragmented and updated inconsistently across various client applications (e.g., web portal, mobile app). This leads to data discrepancies, poor user experience, and a lack of a single, authoritative source for user data. Manual reconciliation is inefficient and error-prone.

**Goal:** To establish a robust, secure, and standardized API for managing core user profile data. This API will serve as the single source of truth, enabling real-time, consistent updates across all integrated client applications and internal services.

## 2. Target Users / ICP Roles

*   **Internal Frontend Developers:** (Web, Mobile) - Consume the API to display and update user profiles within their respective applications.
*   **Internal Backend Services:** - Utilize the API for system-level profile interactions (e.g., authentication services, analytics).
*   **External Partner Developers:** (Future consideration, if API is exposed externally) - Integrate partner applications with our user profile data.

## 3. Scope

This phase focuses on core CRUD (Create, Read, Update, Deactivate) operations for essential user profile attributes via a RESTful API endpoint, including robust authentication, authorization, and basic data validation.

## 4. Functional Requirements

### 4.1. Endpoint Structure

*   **REQ-001:** The API shall expose a dedicated endpoint for user profile management, specifically `/api/v1/user/profile`.
    *   **Implementation Note:** Expected route definition: `routes/api/v1/user/profile.js`
*   **REQ-002:** All API interactions with this endpoint shall use standard HTTP methods (GET, PUT, DELETE).

### 4.2. Profile Retrieval (Read)

*   **REQ-003:** An authenticated GET request to `/api/v1/user/profile` shall retrieve the requesting user's current profile data.
*   **REQ-004:** The retrieved profile data shall include `id`, `name`, `email`, `avatarUrl`, and `bio`.
*   **REQ-005:** The response format shall always be JSON.

### 4.3. Profile Update (Update)

*   **REQ-006:** An authenticated PUT request to `/api/v1/user/profile` shall allow for partial updates of the requesting user's profile.
*   **REQ-007:** Updatable fields include `name`, `email`, `avatarUrl`, and `bio`.
*   **REQ-008:** The `email` field must be unique across all active users.
*   **REQ-009:** The `email` field must adhere to a valid email format (e.g., `user@domain.com`).
*   **REQ-010:** The `avatarUrl` field must be a valid URL.
*   **REQ-011:** The request and response formats shall be JSON.

### 4.4. Profile Deactivation (Soft Delete)

*   **REQ-012:** An authenticated DELETE request to `/api/v1/user/profile` shall "soft delete" the requesting user's profile by setting an `is_active` flag to `false`. The user record itself will not be physically removed from the database.
*   **REQ-013:** Subsequent GET requests for a deactivated user's profile shall indicate the profile is unavailable or deactivated.

### 4.5. Security & Robustness

*   **REQ-014:** All profile API endpoints shall require valid Bearer Token authentication.
    *   **Implementation Note:** This integrates with `middleware/auth.js`.
*   **REQ-015:** The API shall implement rate limiting for authenticated users on all `/api/v1/user/profile` endpoints to prevent abuse.
    *   **Implementation Note:** Expected configuration in `config/rate-limiter.js`.

## 5. Acceptance Criteria

*   **AC-001 (Read Profile):**
    *   **Given** an authenticated user
    *   **When** they send a `GET` request to `/api/v1/user/profile`
    *   **Then** the API responds with `HTTP 200 OK` and a JSON body containing their current profile (`id`, `name`, `email`, `avatarUrl`, `bio`).
    *   **Given** an unauthenticated request
    *   **When** a `GET` request is sent to `/api/v1/user/profile`
    *   **Then** the API responds with `HTTP 401 Unauthorized`.
*   **AC-002 (Update Profile - Valid):**
    *   **Given** an authenticated user
    *   **When** they send a `PUT` request to `/api/v1/user/profile` with `{ "name": "New Name", "bio": "Updated bio" }`
    *   **Then** the API responds with `HTTP 200 OK` and a JSON body reflecting the updated profile.
    *   **And** subsequent `GET` requests for the profile return the new name and bio.
*   **AC-003 (Update Profile - Invalid Email Format):**
    *   **Given** an authenticated user
    *   **When** they send a `PUT` request to `/api/v1/user/profile` with `{ "email": "invalid-email" }`
    *   **Then** the API responds with `HTTP 400 Bad Request` and an error message indicating invalid email format.
*   **AC-004 (Update Profile - Duplicate Email):**
    *   **Given** an authenticated user (User A) and another active user (User B) with `email: "userb@example.com"`
    *   **When** User A sends a `PUT` request to `/api/v1/user/profile` with `{ "email": "userb@example.com" }`
    *   **Then** the API responds with `HTTP 409 Conflict` and an error message indicating the email is already taken.
*   **AC-005 (Update Profile - Invalid Avatar URL):**
    *   **Given** an authenticated user
    *   **When** they send a `PUT` request to `/api/v1/user/profile` with `{ "avatarUrl": "not-a-url" }`
    *   **Then** the API responds with `HTTP 400 Bad Request` and an error message indicating an invalid URL format.
*   **AC-006 (Deactivate Profile):**
    *   **Given** an authenticated user with an active profile
    *   **When** they send a `DELETE` request to `/api/v1/user/profile`
    *   **Then** the API responds with `HTTP 204 No Content`.
    *   **And** subsequent `GET` requests to `/api/v1/user/profile` for that user result in `HTTP 404 Not Found` (or specific `HTTP 410 Gone` / deactivated status).
    *   **And** the user's `is_active` flag in the database is set to `false`.
*   **AC-007 (Rate Limiting):**
    *   **Given** an authenticated user
    *   **When** they send 101 requests to `/api/v1/user/profile` within a 60-second window
    *   **Then** the 101st request and subsequent requests within that window respond with `HTTP 429 Too Many Requests`.
    *   **And** requests before the 101st are handled successfully (assuming valid).

## 6. Out of Scope

*   Password change or reset functionality (handled by a separate `auth` service).
*   Direct profile image upload (only `avatarUrl` string storage is in scope; image hosting/upload is a separate service).
*   Public user profiles or search functionality.
*   Administrator-level management of other users' profiles.
*   Real-time notifications or webhooks for profile changes.
*   User account creation (sign-up) functionality.
*   Complex data types or nested profile objects beyond the specified fields.