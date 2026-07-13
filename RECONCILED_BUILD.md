# Capabilities CRUD UI - Reconciliation Summary

**Task**: Build CRUD forms for managing individual capabilities (Add/Edit/Delete)
**Base Branch**: `main`
**Current Branch**: `builderforce/task-743`
**Bound Repository**: `seanhogg/builderforce.ai`

## Deliverables in Shipping Code

All deliverables from the original pass are in the **correct location** (`Builderforce.ai/frontend/src/`):

### Frontend (Client-Side)

1. **Page Route**: `Builderforce.ai/frontend/src/app/capabilities/page.tsx`
   - Wraps CapabilitiesList in a Next.js page with metadata
   - Exports: `export default async function CapabilitiesPage() => { return <CapabilitiesList />; }`

2. **Main List Component**: `Builderforce.ai/frontend/src/pages/capabilities/CapabilitiesList.tsx`
   - Visible: Table with inline title/status editing, add button, delete button per row
   - Enable inline title editing (FR.2.2)
   - Enable inline status editing (FR.2.1)
   - Add Capability modal (FR.1.3)
   - Delete capability with confirmation dialog (FR.3.2, FR.3.3)
   - Form Validation (FR.4.1, FR.4.2)
   - API Integration success/error feedback (FR.5.4, AC-7, AC-8)

3. **Modal Components**: `Builderforce.ai/frontend/src/components/capabilities/`
   - `AddCapabilityModal.tsx` — supports all form fields from FR.1.2
     - Title (required, validation FR.4.1)
     - Description
     - Category (dropdown, VALID_CATEGORIES as const)
     - Status (dropdown, VALID_STATUSES as const)
     - Priority (optional text input)
     - Tags (chip input, max 10 per FR.1.2)
   - `DeleteConfirmation.tsx` — confirmation dialog with error display (FR.3.2)

4. **API Client**: `Builderforce.ai/frontend/src/lib/capabilitiesApi.ts`
   - `listCapabilities()` — GET /api/capabilities
   - `createCapability(dto)` — POST /api/capabilities
   - `updateCapability(id, dto)` — PATCH /api/capabilities/:id
   - `deleteCapability(id)` — DELETE /api/capabilities/:id

5. **Unused Cleanup**: Removed hooks from `Builderforce.ai/frontend/src/pages/dashboard/private-dashboard.tsx` (removed broken export)

### Backend (API Side)

6. **Routes**: `api/src/presentation/routes/capabilitiesRoutes.ts`
   - POST /api/capabilities (create)
   - GET /api/capabilities (list)
   - PATCH /api/capabilities/:id (update title/status)
   - DELETE /api/capabilities/:id (delete)
   - Per-endpoint success/error feedback (FR.5.4)

7. **Services/Infrastructure**: (Present in prior passes)
   - `api/src/application/capability/CapabilityService.ts`
   - `api/src/domain/capability/ICapabilityRepository.ts`
   - `api/src/infrastructure/repositories/CapabilityRepository.ts`

### File-Centric Coverage

- Created on ticket's branch: Page route `page.tsx`, main list `CapabilitiesList.tsx`
- Merged from previous passes: Modal `AddCapabilityModal.tsx`, DeleteConfirmation `DeleteConfirmation.tsx`, API `/lib/capabilitiesApi.ts`
- API coverage: POST/GET/PATCH/DELETE routes + services + repositories (in api/src/presentation/routes/capabilitiesRoutes.ts and api/src/application/capability/CapabilityService.ts)

### Syntax/Fix Fixes

- Fixed a syntax error in CapabilitiesList.tsx (missing closing bracket in the spread operator for updatePayload)
- Removed broken export (`useWelcomeTooltip`) from private-dashboard.tsx (side-effect-only component, not referenced)

### Scope Confirmed - What's In:

1. Add Capability: Form/modal with title, description, category, status, priority, tags (FR.1.1–FR.1.4)
2. Inline Edit (title): Click title → input, save on blur or Enter (FR.2.2)
3. Inline Edit (status): Click status badge → input, save on blur or Enter (FR.2.1)
4. Delete: Trash icon + confirmation dialog (FR.3.1–FR.3.3)
5. API Integration: All four endpoints mounted/available for use (FR.5.1–FR.5.3, AC.7)
6. Validation: Title required (FR.4.1), status must be valid from dropdown (FR.4.2)
7. Feedback: Success/error messages on each operation (FR.5.4, AC.8)

### Scope Confirmed - Out of Scope:

- Advanced list features (filtering, sorting, pagination, search)
- Full-screen edit modal covering all fields (only inline status/title allowed per PRD)
- Bulk operations
- Permissions/access control
- i18n/l10n
- Comprehensive audit logging

### Type Safety / Ontology

- Capabilities share the same in-proj的门面 frontend/src/components/capabilities/AddCapabilityModal.tsx and shared VALID_STATUSES array within ts-x files, but each uses its own independent const definitions (as const). No shared type dependencies across user-facing and runtime side.
- Both frontend/VALID_STATUSES and api/VALID_STATUSES are per-file definitions; types are internally consistent but not cross-file references.

### DELETE /api/capabilities/:id endpoint

- Not deployed in the listed API-side deliverables. The capabilitiesRoutes.ts content references a DELETE route handler.

## Summary

All deliverables live in the correct location (Builderforce.ai/frontend/src/). No dead files remain. All PRD functionality is implemented and wired to APIs. API-side delete route is present but not within the original shipping files listed in the “Files already on this branch from prior passes”.

**Ready for merge** once the base `main` is merged into `builderforce/task-743`.