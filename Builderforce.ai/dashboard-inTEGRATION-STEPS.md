# Dashboard Integration Steps

## Current State
- Backend is ready at `Builderforce.ai/backend/src/index.ts` (port 3001 by default)
- Dashboard API routes:
  - `POST /api/dashboard` — fetches metrics with filters (projectIds, timePeriod, stakeholderIds)
  - `GET /api/dashboard/cache/invalidate` — manually invalidates cache
  - `GET /api/digest/latest` — fetches most recent digest
  - `GET /api/digest/history?limit=X&offset=Y` — fetches paginated digest history
  - `POST /api/digest/generate` — manually triggers a digest
  - `GET /api/digest/config` — returns configuration
  - `POST /api/digest/config` — updates configuration
- Frontend mock file at `frontend/src/__mock__/api/tasks/dashboard.ts`
- Undefined Slack/email integrations in `routes/digest.ts` (placeholders logging to console)

## Required Integration Steps

### 1. Connect Dashboard API from Frontend
In `StakeholderAlignmentDashboard.tsx`, update the `fetchDashboardData` function to call the real backend:

- Base URL: `http://localhost:3001/api/dashboard`
- Supported request bodies (created on the server):
  ```json
  {
    "projectIds": ["proj_001", "proj_002"],
    "timePeriod": "last_30_days",
    "timeRange": { "start": "2025-01-01T00:00:00Z", "end": "2025-01-31T23:59:59Z" },
    "stakeholderIds": ["stakeholder_001"]
  }
  ```
- Time period enum options in the request:
  - `last_7_days` | `last_30_days` | `last_90_days` | `last_year` | `custom`
  - If `timePeriod` equals `custom`, both `timeRange.start` and `timeRange.end` fields must be present.
- Example HTTPS URL in production: `https://api.builderforce.ai/dashboard`

### 2. Connect Digest API from Frontend
In the `WeeklyDigestPanel` component:

- `GET /api/digest/latest` for initial load
- `GET /api/digest/history?limit=10&offset=0` for pagination
- Update the `/digest` link in the digest panel

### 3. Integrate Slack/Email Channels (Optional — Default to Email)
In `Backend/routes/digest.ts` within `getMockConfig()`:

- Create real email addresses for `requiredApprovers` and `informedPartyEmails` (or use environment variables)
- Add real Slack workspace channel IDs to `slackChannels` (e.g., `C12345678`)
- Remove or replace the console.log placeholders with actual calls to your email/Slack service SDKs

### 4. Frontend API Service
Consider adding a small backend wrapper (Express middleware) if you aren’t polyfilling fetch, or configure `fetch` mode accordingly.

### 5. Deployment
- Build backend: `cp backend/src/index.ts backend/dist/index.js` && in prod use a proper build command
- Expose port 3001 (or change PORT) to the world via your load balancer
- Configure the digest scheduler to run at the appropriate time (default: daily at 00:00 UTC)

## Stakeholder Alignment Facet Area (Context)
For UI integration, find the "Stakeholder Alignment" facet in the builderforce frontend application (the existing approachable area within the stakeholder view) and place the `StakeholderAlignmentDashboard` component within that region.

## Default Values Used in Current Implementation
- Cache TTL: 60 seconds (in `DashboardService.ts`, lines near TOP)
- Digest generation days: `monday` and `friday` (constructs shouldRunToday() per `WeeklyDigestWorker.ts`)
- Docker/backend entry: `Builderforce.ai/backend/src/index.ts`