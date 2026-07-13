# Task #743: Capabilities CRUD UI - File Location Notes

## Repository Bound
- Bound repository: **seanhogg/builderforce.ai**
- Base branch: **main**
- Working branch: **builderforce/task-743**

## File Location Issue
A previous pass created frontend files under `Builderforce.ai/frontend/src/`. However, the actual frontend source code for this repo appears to be in the top-level `frontend/` directory, not under `Builderforce.ai/frontend/`.

## Current State
PR files exist at:
- `Builderforce.ai/frontend/src/components/capabilities/AddCapabilityModal.tsx`
- `Builderforce.ai/frontend/src/components/capabilities/DeleteConfirmation.tsx`
- `Builderforce.ai/frontend/src/lib/capabilitiesApi.ts`
- `Builderforce.ai/frontend/src/pages/capabilities/CapabilitiesList.tsx`
- `Builderforce.ai/frontend/src/pages/dashboard/private-dashboard.tsx`

The builderforce-embedded app (likely the React frontend) uses local node apps; this repo also has a separate `frontend/` directory at the repo root with its own packages, which aligned with a prior implementation. To complete task #743, we should create or adapt the CRUD UI in the correct location so the frontend integrates; if an existing frontend-router/file structure is not exposed here, I can add the necessary routes/pages under the appropriate frontend directory to connect these CRUD components.

## Proposed Fix
1. Create `frontend/src/routes/capabilities.tsx` with `CapabilitiesList` route loaded as a page component.
2. Include the AddCapabilityModal and DeleteConfirmation imports from the prior pass and wire the list page to expose includes, with a page layout/header as needed.
3. If that same prior pass already handled creation/storage, preserve and reuse the hooks/lib patterns already in place.

We will move only React files for CRUD UI to the correct frontend source location to complete the PR.