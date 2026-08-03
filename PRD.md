> **PRD** — drafted by Ada (Sr. Product Mgr) · task #555
> _Each agent that updates this PRD signs its change below._

# PRD: Sync PagerDuty Services and Escalation Policies for Mapping

## Problem & Goal

**Problem**  
Users need to map PagerDuty services and escalation policies to internal resources (boards, teams, etc.) but currently no mechanism exists to fetch and list those PagerDuty entities. The existing `PagerDutyBoardProvider` may only expose incident/schedule data, leaving a gap for service and policy selection.

**Goal**  
Enable users to browse, search, and select PagerDuty services and escalation policies from within the application so that they can be mapped to internal objects. The data must be synced from PagerDuty with minimal latency and kept reasonably fresh.

## Target Users / ICP Roles

- **Platform Administrators** configuring PagerDuty integrations
- **Incident Managers / DevOps Engineers** mapping PagerDuty services to boards or teams
- **Owner/Admin persona** within the tool who sets up automation rules

## Scope

- Extend the backend `PagerDutyBoardProvider` (or create dedicated endpoint handlers) to expose:
  - List of PagerDuty services (ID, name, description, status)
  - List of PagerDuty escalation policies (ID, name, description)
- Provide a caching layer with configurable TTL to avoid excessive API calls to PagerDuty
- Expose these lists via REST or GraphQL endpoints usable by the frontend
- Frontend UI components: searchable dropdown, table, or selector to pick one or more services/policies for mapping
- Support manual sync trigger and optionally automatic periodic refresh
- Retain backward compatibility with existing provider functionality (no impact to current board data)

**Out of Scope**  
- Creating, updating, or deleting PagerDuty services/policies from the application
- Real-time event-driven sync (webhooks) – initial version uses poll-based sync
- Mapping logic itself (i.e., how mappings are stored and used) – this PRD only delivers the source data
- Import/export of mappings in bulk

## Functional Requirements

- **FR1: PagerDuty Service Listing**  
  The system shall expose a list of all services from the connected PagerDuty account, including at minimum: `id`, `name`, `description`, `status`, `teams` (if available). List must support search/filter by name.

- **FR2: Escalation Policy Listing**  
  The system shall expose a list of all escalation policies: `id`, `name`, `description`, `num_loops`. Support filtering by name.

- **FR3: Provider Extension**  
  The `PagerDutyBoardProvider` (or a new dedicated service) shall implement methods to fetch services and escalation policies, using the existing PagerDuty API client configuration already present in the provider.

- **FR4: Caching**  
  Fetched data shall be cached server-side with a default TTL of 5 minutes (configurable). Cache is invalidated manually via a `refresh` endpoint or automatically on TTL expiry.

- **FR5: API Endpoints**  
  - `GET /api/pagerduty/services?query=<string>` – returns filtered list of services  
  - `GET /api/pagerduty/escalation-policies?query=<string>` – returns filtered list of policies  
  - `POST /api/pagerduty/sync` – triggers a full refresh of cached data (both entities)  
  Both endpoints respect authentication and authorization (admin or mapping permission).

- **FR6: Frontend Integration**  
  - Provide a reusable component (e.g., `PagerDutyEntitySelector`) that can be embedded in mapping configuration forms.  
  - Display entity name and additional details (e.g., service status) in a dropdown or autocomplete.  
  - Show a “Refresh” button to trigger on-demand sync from the UI.

- **FR7: Error Handling**  
  - Graceful degradation: if PagerDuty API is unreachable, return cached data if available, otherwise a clear error message.  
  - Log sync failures for diagnostics.  
  - Rate‑limit PagerDuty API calls to respect current plan limits.

## Acceptance Criteria

1. **Service listing**  
   - When I call the `/pagerduty/services` endpoint, I receive a JSON array of services from PagerDuty.  
   - Filtering by partial name returns only matching services.

2. **Escalation policy listing**  
   - The `/pagerduty/escalation-policies` endpoint returns all policies with correct fields.  
   - Response time < 200ms when cached; < 2s on cache miss.

3. **Sync trigger**  
   - POST to `/sync` clears cache and fetches fresh data from PagerDuty.  
   - Subsequent reads return updated data within 1 second after sync completion.

4. **UI selector**  
   - In a mapping form, I can open a dropdown, type a service name, and see matching PagerDuty services.  
   - Selecting an item stores its ID and name for mapping configuration.  
   - A “Refresh” button is visible and triggers a sync call.

5. **Error state**  
   - If PagerDuty API returns an error, the UI shows a non‑blocking warning and, if cached data exists, still allows selection.  
   - Logged errors include request trace ID.

6. **Existing provider unaffected**  
   - Regression tests confirm that board data retrieval (incidents, schedules) still functions identically.

## Out of Scope

- Bi‑directional sync (pushing changes from the tool to PagerDuty)
- Display of on‑call schedules or escalation paths on the same UI
- Automatic mapping suggestions or rules
- Support for multiple PagerDuty accounts in a single instance (initial scope: one account per tenant)

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