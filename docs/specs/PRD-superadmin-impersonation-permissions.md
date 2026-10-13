# PRD: Super Admin Impersonation & Permission Management
## builderforce.ai · Product Requirements Document

**Version:** 2.0
**Date:** 2026-03-27
**Status:** Draft
**Audience:** Engineering, Design, Product

---

## 1. Overview

### 1.1 Problem Statement

builderforce.ai is a multi-tenant SaaS platform where users operate within tenant workspaces under one of four roles (owner, manager, developer, viewer). When bugs are reported or support escalations occur, the Super Admin currently has only one debug tool: `POST /api/admin/impersonate`, which returns a raw JWT with no UI affordances, no cancel mechanism, no role-switching, and no visibility into what permissions govern the UI elements the affected user sees.

Additionally, there is no backend enforcement of the Super Admin identity on system-admin API routes — any authenticated user with a valid JWT could technically call those endpoints. This is a critical security gap that must be closed as part of this work.

This limits the Super Admin's ability to:
- Reproduce role-specific rendering bugs
- Validate that permissions are applied correctly to UI panels
- Switch between personas without re-authenticating
- Understand what a specific user at a specific tenant with a specific role actually experiences

### 1.2 Goals

1. Give the Super Admin a first-class impersonation experience with full context awareness.
2. Build a permission debugger that overlays permission metadata on every rendered feature and UI panel.
3. Create a visual emulation bar in the application header that persists throughout an impersonation session and cannot be dismissed.
4. Allow the Super Admin to switch between roles from a single dropdown without re-authenticating.
5. Add a separate "role preview" mode that re-renders any page under any role without impersonating a specific user.
6. Deliver a full user management console: view all users across all tenants, manage roles and permissions, and map modules to roles.
7. Add a granular permission layer on top of the existing four-role RBAC hierarchy.
8. Enforce backend authorization on all `/api/admin/*` routes (currently only checks authentication).
9. Produce a full audit trail of every admin action, impersonation session, and permission change.

### 1.3 Non-Goals

- This PRD does not change the self-service role management available to tenant Owners/Managers.
- This PRD does not change billing or plan-limit enforcement (that is plan-tier logic, not RBAC).
- Impersonation is Super Admin only — it is not delegated to tenant admins.
- No real-time permission streaming / WebSocket permission refresh.
- No row-level security beyond existing tenant isolation.

---

## 2. Background & Current State

### 2.1 Existing Capabilities

| Area | Current State |
|---|---|
| **Roles** | Four hardcoded roles: `owner > manager > developer > viewer`, enforced per route via `requireRole()` middleware |
| **Impersonation** | `POST /api/admin/impersonate` returns a valid tenant JWT; Super Admin must manually set the token — no UI, no cancel, no context |
| **Backend auth on admin routes** | `superAdminMiddleware` validates `sa: true` claim + hardcoded email; does **not** block non-SA users from calling admin routes if they hold a valid JWT without the SA claim |
| **Admin Console** | 15-tab panel at `/admin` covering health, billing, users, tenants, security, errors, etc. |
| **Session Mgmt** | Per-user sessions with IP/UA tracking and revocation |
| **Feature Flags** | Plan-tier hard limits only (`FREE / PRO / TEAMS`); no per-role or per-module feature gates |
| **Permission Debugger** | None |
| **Emulation Bar** | None |
| **Role Switcher** | None |
| **Role Preview (no user)** | None |
| **Module → Permission mapping** | None; all access is role + plan tier |

### 2.2 Key Gaps

| # | Gap | Severity |
|---|---|---|
| G-1 | No UI for impersonation — raw JWT only | Critical |
| G-2 | No cancel mechanism for impersonation | Critical |
| G-3 | No backend authorization enforcement on `/api/admin/*` | Critical (security) |
| G-4 | No emulation bar / context display | High |
| G-5 | No role switcher during impersonation | High |
| G-6 | No role preview mode without a target user | High |
| G-7 | No permission debugger | High |
| G-8 | No module → role/permission mapping | High |
| G-9 | No granular permissions beyond four roles | High |
| G-10 | Role management UI absent from admin console | High |
| G-11 | No audit log for admin actions | High |
| G-12 | No protection against nested impersonation | Medium |
| G-13 | No per-user permission overrides | Medium |
| G-14 | Super Admin hardcoded to a single email (does not scale) | Medium |

---

## 3. User Stories

### Super Admin

- **SA-1**: As a Super Admin, I can search for any user across any tenant and begin impersonating them in one click, so I can reproduce the exact experience they reported.
- **SA-2**: As a Super Admin, when I am impersonating a user, I see a persistent emulation bar in the page header showing the target user's name, tenant, role, active permission count, and elapsed time. The bar cannot be dismissed.
- **SA-3**: As a Super Admin, I can end impersonation from the emulation bar and return to my own Super Admin session without re-authenticating.
- **SA-4**: As a Super Admin, I can switch roles from the emulation bar dropdown while staying within the same user/tenant context, so I can compare how the same page renders across different role levels.
- **SA-5**: As a Super Admin, I can preview how any page looks to a given role without impersonating a specific user, so I can quickly validate UI gating in isolation.
- **SA-6**: As a Super Admin, I can toggle the Permission Debugger to see an overlay on every UI element indicating what permission or role gates it, including elements that are hidden.
- **SA-7**: As a Super Admin, I can copy a full context blob from the emulation bar to paste directly into a bug report.
- **SA-8**: As a Super Admin, I can view and edit the role assigned to any user within any tenant.
- **SA-9**: As a Super Admin, I can create, edit, and delete custom roles within a tenant, and assign granular permissions to those roles.
- **SA-10**: As a Super Admin, I can define modules and map them to one or more roles/permissions so that assigning a user to a module automatically grants the correct access.
- **SA-11**: As a Super Admin, I can see a full audit log of all admin actions, impersonation sessions, role changes, and permission mutations.
- **SA-12**: As a Super Admin, I can force-reset a user's password, revoke all their sessions, or disable their MFA from the user detail drawer.

---

## 4. Feature Specifications

---

### 4.1 Emulation Bar

**Location:** Fixed top banner inside the application header, rendered above the primary navigation. Visible only when an active impersonation session or role preview is in progress.

**Trigger:** Activated when the Super Admin starts an impersonation session from the Admin Console, or activates Role Preview mode.

**Variants:**
- **Amber bar** — Super Admin is actively impersonating a specific user.
- **Blue bar** — Role Preview mode active (no specific user; frontend-only).

**Content (impersonation mode):**

| Element | Description |
|---|---|
| Warning badge | Amber pill: "EMULATING SESSION" |
| Target identity | Avatar + display name + email of the impersonated user |
| Tenant | Tenant name + slug |
| Active role | Current role being emulated (e.g., "Developer") |
| Permission count | "Permissions: 18 active" — clickable, opens Permission Debugger panel |
| Session timer | Elapsed time since start. Turns amber at 50 minutes to warn of approaching TTL expiry |
| Permission Debugger toggle | On/Off switch that activates the permission overlay (keyboard shortcut: `Ctrl+Shift+P`) |
| Role Switcher dropdown | Switch to a different role within the same tenant/user context (see §4.3) |
| Copy Context button | Copies a JSON blob of the full emulation context to clipboard (user id, tenant id, role, permissions, session id, timestamp) — for direct inclusion in a bug report |
| End Emulation button | Terminates impersonation and returns to Super Admin session |

**Content (role preview mode):**

| Element | Description |
|---|---|
| Info badge | Blue pill: "PREVIEWING ROLE" |
| Role label | "Previewing as: [owner ▾]" with dropdown to switch roles |
| Exit Preview button | Ends role preview; restores Super Admin own context |

**Behavior:**
- The bar must be visually distinct from all normal UI chrome. It is CSS-enforced — not a dismissable toast or overlay. It cannot be minimized.
- The browser tab title gains a suffix while active: `— [Emulating: jane@acme.com]` or `— [Role Preview: owner]`. Useful for distinguishing screenshots in bug reports.
- All user actions taken while impersonating are blocked at the server (see §4.2.6). Destructive writes require an additional in-UI confirmation modal warning "You are about to perform this action as [user]."
- Emulation bar state is stored **in memory only** (not localStorage) to prevent accidental re-entry on page reload.
- Token TTL warning appears as a toast at T-10 and T-5 minutes. On expiry the session auto-ends and the admin is redirected to `/admin`.

**Write-Protection Rules:**
The following action categories require explicit Super Admin confirmation before execution in an impersonated context:

- Any DELETE operation
- Payment / subscription mutations
- Sending emails or notifications on behalf of the user
- Revoking sessions for other workspace members

---

### 4.2 Impersonation Flow

#### 4.2.1 Start Impersonation

**Entry points:**
- Admin Console → Users tab → user row → "Impersonate" action
- Admin Console → Tenants tab → tenant row → "Impersonate as Owner" shortcut (one-click, bypasses user search)
- Admin Console → Tenants tab → members list → "Impersonate" per member

**Flow:**

1. Super Admin clicks "Impersonate" next to a user record.
2. Server immediately rejects (403) if the target is another Super Admin.
3. Server rejects (409) if the requesting admin already has an active impersonation session.
4. A confirmation modal appears:
   - User: `[displayName] <email>`
   - Tenant: `[tenantName]`
   - Role: `[current role]` — editable dropdown to start as a different role
   - **Reason** (required, non-empty text field — stored permanently in audit log)
   - Checkbox: "Enable Permission Debugger on start"
   - Buttons: "Start Emulation" / "Cancel"
5. On confirm, the backend issues an **emulation token** (see §4.2.5) and creates an `admin_impersonation_sessions` record.
6. The frontend stores the emulation token **in memory only** and sends it via `X-Emulation-Token` header on all subsequent API calls. The admin's own `Authorization: Bearer` is never replaced.
7. The page re-renders as the impersonated user's view. The Emulation Bar mounts in the header.
8. If "Enable Permission Debugger" was checked, the debugger overlay activates immediately.

#### 4.2.2 End Impersonation

1. Super Admin clicks "End Emulation" in the Emulation Bar (or the token expires).
2. The emulation token is cleared from memory.
3. `POST /api/admin/impersonation/:id/end` is called; server invalidates the JTI immediately.
4. Audit log entry: `IMPERSONATION_ENDED` with duration, pages visited count, write-block count, and end reason (`MANUAL | EXPIRED | ADMIN_LOGOUT`).
5. A toast appears: "Emulation session ended. Duration: 12m 33s."
6. The Super Admin is redirected to the Admin Console page they were on before starting, or to `/admin`.

#### 4.2.3 Session Constraints

- **One session at a time**: `POST /api/admin/impersonation/start` returns `409 Conflict` if the admin already has an active session.
- **Cannot impersonate a Super Admin**: Returns `403 Forbidden` with a clear error message.
- **1-hour TTL**: Emulation tokens expire after 1 hour, non-renewable. A new session must be started.
- **Memory-only state**: Impersonation state is not written to localStorage. A page reload cleanly terminates the client-side session (server session record remains; admin can explicitly end it from the Active Sessions dashboard).

#### 4.2.4 In-Session Role Switching

While impersonating, the Super Admin can switch the active role without ending the session. This allows side-by-side comparison of how the same page renders across roles.

**Behavior:**
- The Role Switcher dropdown in the Emulation Bar lists all built-in roles + any custom roles for the active tenant.
- Current role is checkmarked.
- On selection, `POST /api/admin/impersonation/:id/switch-role { role }` is called.
- Server issues a new emulation token with updated role claims.
- The page re-renders in-place (same route). No navigation.
- Emulation Bar updates to reflect the new role.
- Browser tab title suffix updates: `— [Emulating: jane@acme.com | owner]`.
- Each switch is logged as a sub-event in `admin_impersonation_role_switches`.
- **"Try any permission set" sandbox**: A special option in the Role Switcher composes an ad-hoc permission set in a modal. The admin selects individual permissions manually. This does not persist to the database — it is a one-off hypothesis test during a debug session.

#### 4.2.5 Emulation Token Design

**Request:**
```json
{
  "userId": "uuid",
  "tenantId": "uuid",
  "role": "developer",
  "reason": "Customer reports billing tab is blank (ticket #4821)",
  "enableDebugger": false
}
```

**Response:**
```json
{
  "emulationSessionId": "uuid",
  "token": "eyJ...",
  "user": { "id", "email", "displayName", "avatarUrl" },
  "tenant": { "id", "name", "slug" },
  "role": "developer",
  "permissions": ["project:read", "task:write", ...],
  "startedAt": "ISO8601",
  "expiresAt": "ISO8601"
}
```

**Token payload:**
```json
{
  "sub": "<target-user-id>",
  "tid": "<tenant-id>",
  "role": "developer",
  "permissions": ["project:read", "task:write", ...],
  "emu": true,
  "emu_by": "<superadmin-user-id>",
  "emu_sid": "<emulation-session-id>",
  "emu_readonly": true,
  "jti": "...",
  "exp": ...
}
```

The `emu_readonly: true` flag causes API middleware to reject all mutating verbs (`POST`, `PUT`, `PATCH`, `DELETE`) with `403 Forbidden` unless the endpoint is explicitly allow-listed. The `X-Emulation-Token` header carries this token; `Authorization: Bearer` continues to carry the admin's own unmodified token.

#### 4.2.6 API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/impersonation/start` | Start impersonation; returns emulation token + session record |
| `POST` | `/api/admin/impersonation/:id/end` | End session; invalidates JTI server-side |
| `POST` | `/api/admin/impersonation/:id/switch-role` | Switch active role within session |
| `GET` | `/api/admin/impersonation/active` | Get current active session for this admin |
| `GET` | `/api/admin/impersonation` | List all sessions (paginated, filterable) |
| `GET` | `/api/admin/impersonation/:id` | Session detail + role switch history |

---

### 4.3 Role Preview Mode (No Specific User)

**Purpose:** Allow the Super Admin to preview how any page renders under a given role without impersonating a specific user. Useful for quickly validating UI gating without having to find a real user.

**Entry:** "Preview as role" dropdown in the application header — visible to Super Admins only, outside of any impersonation session.

**Behavior:**
- Selecting a role activates the blue Emulation Bar variant: "PREVIEWING [owner] ROLE."
- The current page re-renders with the selected role's permission set applied — permission checks in the frontend use the preview role instead of the Super Admin's own permissions.
- **Frontend-only**: No API call is made. No data scoping changes. The Super Admin still sees their own data; only the visibility/permission logic re-evaluates.
- All built-in roles are available in the dropdown. Custom roles added to any tenant are also listed (grouped by tenant).
- The Permission Debugger can be toggled independently in preview mode.
- Clicking "Exit Preview" (or selecting a new role to switch) restores the Super Admin's own context.
- Role preview state is never persisted. Page reload exits preview mode.

---

### 4.4 Permission Debugger

**Activation:**
- Toggle in the Emulation Bar (during impersonation or role preview).
- Keyboard shortcut: `Ctrl+Shift+P`.
- Header debug dropdown (Super Admin only, even outside of impersonation).

**Behavior when active:**
- Every UI element wrapped in a `<PermissionGate>` receives a colored border overlay:
  - **Green** = permission granted; element is rendered.
  - **Red dashed** = permission denied; element is hidden. Ghost outline shows where it *would* appear.
  - **Yellow** = soft-gate; element is visible but read-only/disabled.
- Hovering a bordered element shows a tooltip:

```
┌──────────────────────────────────────────────────┐
│  Permission: project:delete                      │
│  Status:     DENIED                              │
│  Requires:   ≥ manager                           │
│  Granted via: —                                  │
│  API endpoint: DELETE /api/projects/:id          │
└──────────────────────────────────────────────────┘
```

- A floating side panel opens with full permission breakdown.

**Permission Debugger Panel (side drawer):**

```
┌─────────────────────────────────────────────────────────┐
│  Permission Debugger            [Copy All] [Export CSV] [×]  │
│─────────────────────────────────────────────────────────│
│  User: Jane Doe · Role: developer · Modules: 2          │
│  Active: 18 / 34 total permissions                      │
│  [Page] [User] [Role] [Missing]                         │
│─────────────────────────────────────────────────────────│
│  Permission               Status    Source     Count    │
│  ──────────────────────────────────────────────────     │
│  project:read             GRANTED   Role          3    │
│  project:delete           DENIED    —              1    │
│  task:write               GRANTED   Module         4    │
│  billing:read             DENIED    —              1    │
│  ...                                                     │
└─────────────────────────────────────────────────────────┘
```

**Panel tabs:**
- **Page**: All permissions evaluated during the current page render.
- **User**: Full permission set the current user/emulated user holds.
- **Role**: Permissions grouped by role for side-by-side comparison.
- **Missing**: Only permissions evaluated as DENIED (including elements not rendered at all).

**Panel columns:**
- **Permission**: `resource:action` key. Clickable — navigates to the Roles & Permissions page entry for that permission.
- **Status**: GRANTED / DENIED / SOFT-GATE.
- **Source**: Role / Module / Override / — (denied with no source).
- **Count**: Number of UI elements on the current page gated by this permission.
- **"Copy All"**: Exports the full page permission matrix as JSON.
- **"Export CSV"**: Exports to CSV for inclusion in compliance review or bug report.

**`PermissionGate` component:**

```tsx
// Standard usage
<PermissionGate permission="project:delete" fallback={<LockedState />}>
  <DeleteButton />
</PermissionGate>

// With API endpoint annotation for debugger tooltip
<PermissionGate permission="project:delete" apiEndpoint="DELETE /api/projects/:id">
  <DeleteButton />
</PermissionGate>
```

When the debugger is active, `PermissionGate`:
- Renders a green-bordered wrapper around granted elements.
- Renders a red dashed ghost box where denied elements would appear.
- Renders a yellow border on soft-gated fallback content.
- Registers itself with `PermissionDebuggerProvider` context (component name, permission, result, grant source, DOM ref).

The component emits a `data-permission` attribute on its root DOM node:
```html
<div data-permission="project:delete" data-permission-status="denied">
```

All existing inline `hasPermission()` checks must be migrated to `<PermissionGate>` as part of Phase 3.

---

### 4.5 Granular Permissions & Custom Roles

#### 4.5.1 Permission Schema

Introduce a permission registry with explicit `resource:action` grants per role. The registry is stored in the database as `role_permission_overrides` — the default matrix is the baseline; overrides layer on top. This allows the Super Admin to edit permissions per role without changing hardcoded defaults.

Add a **System** permission category for Super Admin–only capabilities:

| Category | Permissions |
|---|---|
| Projects | `project:read`, `project:write`, `project:delete`, `project:archive` |
| Tasks | `task:read`, `task:write`, `task:delete`, `task:assign` |
| Workflows | `workflow:read`, `workflow:write`, `workflow:execute`, `workflow:delete` |
| Agents | `agent:read`, `agent:register`, `agent:configure`, `agent:delete` |
| Members | `member:read`, `member:invite`, `member:remove`, `member:promote` |
| Billing | `billing:read`, `billing:manage` |
| Reports | `report:read`, `report:export` |
| Approvals | `approval:read`, `approval:approve`, `approval:configure` |
| Marketplace | `marketplace:read`, `marketplace:purchase`, `marketplace:publish` |
| API Keys | `apikey:read`, `apikey:rotate`, `apikey:delete` |
| Audit | `audit:read` |
| System | `system:impersonate`, `system:debug_permissions`, `system:manage_roles`, `system:manage_modules` |

#### 4.5.2 Built-in Role → Permission Mapping

| Permission | viewer | developer | manager | owner |
|---|---|---|---|---|
| `project:read` | ✅ | ✅ | ✅ | ✅ |
| `project:write` | | ✅ | ✅ | ✅ |
| `project:delete` | | | ✅ | ✅ |
| `project:archive` | | | ✅ | ✅ |
| `task:read` | ✅ | ✅ | ✅ | ✅ |
| `task:write` | | ✅ | ✅ | ✅ |
| `task:delete` | | | ✅ | ✅ |
| `task:assign` | | ✅ | ✅ | ✅ |
| `workflow:read` | ✅ | ✅ | ✅ | ✅ |
| `workflow:write` | | ✅ | ✅ | ✅ |
| `workflow:execute` | | ✅ | ✅ | ✅ |
| `workflow:delete` | | | ✅ | ✅ |
| `agent:read` | ✅ | ✅ | ✅ | ✅ |
| `agent:register` | | ✅ | ✅ | ✅ |
| `agent:configure` | | | ✅ | ✅ |
| `agent:delete` | | | ✅ | ✅ |
| `member:read` | ✅ | ✅ | ✅ | ✅ |
| `member:invite` | | | ✅ | ✅ |
| `member:remove` | | | ✅ | ✅ |
| `member:promote` | | | | ✅ |
| `billing:read` | | | ✅ | ✅ |
| `billing:manage` | | | | ✅ |
| `report:read` | | ✅ | ✅ | ✅ |
| `report:export` | | | ✅ | ✅ |
| `approval:read` | ✅ | ✅ | ✅ | ✅ |
| `approval:approve` | | | ✅ | ✅ |
| `approval:configure` | | | | ✅ |
| `marketplace:read` | ✅ | ✅ | ✅ | ✅ |
| `marketplace:purchase` | | | ✅ | ✅ |
| `marketplace:publish` | | | | ✅ |
| `apikey:read` | | ✅ | ✅ | ✅ |
| `apikey:rotate` | | ✅ | ✅ | ✅ |
| `apikey:delete` | | | | ✅ |
| `audit:read` | | | ✅ | ✅ |

The Super Admin can edit this matrix from the Admin Console → Roles & Permissions tab. Changes are stored as `role_permission_overrides` records, not code changes. The matrix can be exported as CSV for compliance review.

#### 4.5.3 Per-User Permission Overrides

Beyond role defaults, the Super Admin can grant or revoke specific permissions for individual users within a tenant. These are stored as `granted` / `revoked` arrays on the tenant membership record.

The User Detail Drawer shows:
- **Permissions tab**: Role defaults → per-user grants → per-user revocations → **Effective Permissions** (resolved final set).
- "Add Override" adds a specific permission grant or revocation.
- Last 10 permission changes for this user (who made the change, when).

A role cannot be used to grant permissions the creating admin does not themselves hold — this prevents privilege escalation via role or override creation.

#### 4.5.4 Role Assignment Expiry

When assigning a role or permission override to a user, the Super Admin can optionally set an expiry date. The system auto-revokes the role at expiry and writes a `USER_ROLE_EXPIRED` audit event. A `USER_ROLE_EXPIRY_SET` event is written at assignment time.

#### 4.5.5 Custom Roles (TEAMS plan only)

Tenant Owners and the Super Admin can define custom roles within a tenant. Custom roles:
- Have a name and description.
- Inherit from a base role (one of the four built-ins) and can have permissions added or removed.
- Cannot exceed the permissions of the tenant Owner (no privilege escalation).
- Are stored in `tenant_custom_roles` (see §7).

---

### 4.6 Module → Permission Mapping

A **Module** is a named bundle of permissions (and optionally a minimum base role) that can be assigned to a user within a tenant. Modules allow access to be granted by functional area without requiring knowledge of individual permissions.

**Example Modules:**

| Module | Min Role | Permissions Granted |
|---|---|---|
| `Reporting Access` | viewer | `report:read`, `report:export`, `audit:read` |
| `Workflow Editor` | developer | `workflow:write`, `workflow:execute`, `workflow:delete` |
| `Billing Viewer` | developer | `billing:read` |
| `Marketplace Manager` | manager | `marketplace:purchase`, `marketplace:publish` |
| `Fleet Manager` | manager | `agent:register`, `agent:configure`, `agent:delete` |

**Behavior:**
- Assigning a module grants all module permissions in addition to the user's base role permissions.
- Module permissions are additive; they do not reduce existing role permissions.
- A user can hold multiple modules simultaneously.
- Assigning a module shows a preview: "This will grant: `agent:register`, `agent:configure`, `agent:delete`."
- Removing a module reverses the grant. A warning is shown if the base role also grants some of the same permissions.
- The Permission Debugger side panel shows which permissions come from modules vs. base role vs. per-user overrides.

**Module Management:**
- Super Admin manages platform-wide modules from Admin Console → Modules tab.
- Tenant Owners can define tenant-local modules (TEAMS plan only).

---

### 4.7 User Management Console (Admin → Users Tab — Enhanced)

**Current state:** Tab shows a list of all users with tenant count. No role management.

#### 4.7.1 User List (Cross-Tenant)

**Global search** by name, email, or user ID across all tenants.

| Column | Notes |
|---|---|
| Avatar + Name + Email | Clickable → user detail drawer |
| Tenant count | How many tenants this user belongs to |
| Plan | Highest plan across their tenants |
| Created | Account creation date |
| Last active | From session last-seen tracking |
| MFA | Enabled / not enabled badge |
| Status | Active / Suspended |
| Actions | Impersonate · Reset MFA · Force Logout · Suspend · Delete |

**Filters:** Email/name search, plan tier, tenant, MFA status, superadmin flag, date range.

#### 4.7.2 User Detail Drawer

Sliding drawer with tabs:

**Profile tab:** Display name, email, avatar, bio, MFA status, active session count, consent timestamps, created/updated dates.

**Tenants tab:** Table of all tenant memberships.

| Tenant | Role | Expiry | Modules | Joined | Actions |
|---|---|---|---|---|---|
| Acme Corp | developer | — | Workflow Editor | 2025-10-01 | Edit Role · Assign Module · Impersonate |

- "Edit Role" opens an inline dropdown: built-in + custom roles for that tenant, with optional expiry date.
- "Assign Module" opens the module picker.

**Permissions tab (per selected tenant):**
- Per-user override grants and revocations.
- "Effective Permissions" — computed resolved set: role defaults + module grants + per-user grants − per-user revocations.
- Last 10 permission changes with actor and timestamp.
- "Add Override" button for individual permission grant/revocation.

**Sessions tab:** All active sessions with IP, UA, last seen; revoke individual or all.

**Security tab:**
- Impersonation sessions *targeting this user* (dates, admin actor, duration) — visible to the user in their own settings as "Recent Admin Access" (see §4.10).
- Force Password Reset button (sends reset email on behalf of the user).
- Disable MFA button (for users who have lost their authenticator — requires mandatory audit log entry).
- Force Logout button (increments `session_version` to instantly invalidate all JWTs).

#### 4.7.3 Bulk Operations

Checkbox selection on user list enables:
- Bulk suspend / unsuspend
- Bulk assign to tenant with role
- Bulk assign module
- Bulk export (CSV)
- Each bulk operation writes a `BULK_OPERATION` audit event capturing all affected user IDs.

---

### 4.8 Tenant Management Console (Admin → Tenants Tab — Enhanced)

- Members sub-table per tenant with role column editable inline.
- "Add Module to Member" action per member row.
- Custom roles sub-tab showing tenant-defined roles and permission sets.
- Tenant status toggle: Active / Suspended / Archived.
- "Impersonate as Owner" shortcut button per tenant row.

---

### 4.9 Admin Console → New Tabs

| Tab | Content |
|---|---|
| **Roles & Permissions** | Permission matrix (role × permission) with inline toggles; stored as `role_permission_overrides`; CSV export |
| **Modules** | Create / edit / delete platform modules; permission picker; preview which users have each module |
| **Impersonation Log** | Full audit of all impersonation sessions: actor, target, tenant, role, start/end, duration, IP, debugger flag; expandable role-switch history per row |
| **Audit Log** | Full admin action log — all event types (see §4.11), paginated, filterable by event type / actor / target / date range; CSV export; minimum 12-month retention |

---

### 4.10 Target User Transparency

Users should have visibility that a Super Admin accessed their account, without disclosing confidential admin details.

**What users see** (Account Settings → Security → "Recent Admin Access"):
- Date/time of each impersonation session targeting their account.
- Duration of the session.
- Reason summary (e.g., "Support investigation") — reason text is shown but the admin's identity is not disclosed to avoid internal information exposure.
- No real-time notification is sent during the session. Visibility is post-session only. (Sending a notification risks tipping off a subject of a fraud investigation — see OQ-6.)

---

### 4.11 Audit Logging

All Super Admin actions must be written to the `admin_audit_log` table. Entries are append-only — no UPDATE or DELETE via any API. Minimum retention: 12 months.

**Required events:**

| Event | Trigger |
|---|---|
| `IMPERSONATION_STARTED` | Session starts; includes reason |
| `IMPERSONATION_ENDED` | Session ends; includes end reason (MANUAL / EXPIRED / ADMIN_LOGOUT), duration, pages visited count, write-block count |
| `IMPERSONATION_EXPIRED` | Token TTL exceeded |
| `IMPERSONATION_PERSONA_SWITCHED` | Role switched mid-session |
| `IMPERSONATION_WRITE_ATTEMPT_BLOCKED` | Write attempted and blocked; captures the attempted endpoint |
| `USER_PERSONA_CHANGED` | Super Admin assigns/removes a role |
| `USER_ROLE_EXPIRY_SET` | Role assigned with an expiry date |
| `USER_ROLE_EXPIRED` | Role auto-revoked at expiry |
| `USER_PERMISSION_OVERRIDE` | Per-user permission granted or revoked |
| `USER_STATUS_CHANGED` | User activated / suspended |
| `USER_SESSIONS_REVOKED` | All sessions force-invalidated |
| `USER_MFA_DISABLED_BY_ADMIN` | Admin reset user's MFA |
| `USER_PASSWORD_RESET_FORCED` | Admin-initiated password reset email sent |
| `ROLE_PERMISSION_CHANGED` | Role-level permission matrix updated |
| `MODULE_ASSIGNED` | Module assigned to user |
| `MODULE_REMOVED` | Module removed from user |
| `BULK_OPERATION` | Bulk action; captures event type + all affected user IDs |

---

### 4.12 Backend Authorization Enforcement

**Current problem:** `superAdminMiddleware` validates `sa: true` claim + hardcoded email. Any authenticated user with a different valid JWT can still call admin routes if the middleware is not applied consistently. Additionally, the `isSuperadmin` check is locked to a single hardcoded email.

**Fix:**

1. Migrate `superAdminMiddleware` from email-check to database-backed `isSuperadmin` flag, enabling multiple Super Admins.
2. Apply `requireSuperAdmin` middleware to every route under `/api/admin/*` as a blanket guard — not just selectively.
3. Emulation tokens (`emu: true`) must be rejected by all `/api/admin/*` routes — an active impersonation session must not grant Super Admin access.
4. **2FA enforcement**: Super Admin accounts must have 2FA enabled. The system blocks impersonation endpoint access if 2FA is not configured on the admin's account.

---

### 4.13 Session Version for Instant Token Revocation

Add a `session_version` integer column to the `users` table (default 0). Every API middleware check validates that the `session_version` in the JWT matches the current database value. Calling "Force Logout" increments `session_version` — all existing JWTs for that user become invalid on the next request, without requiring a token blocklist.

---

## 5. API Endpoints

### Impersonation

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/impersonation/start` | Start impersonation; returns emulation token + session record |
| `POST` | `/api/admin/impersonation/:id/end` | End session; invalidates JTI server-side |
| `POST` | `/api/admin/impersonation/:id/switch-role` | Switch active role within session |
| `GET` | `/api/admin/impersonation/active` | Get current active session for this admin |
| `GET` | `/api/admin/impersonation` | List all sessions (paginated, filterable) |
| `GET` | `/api/admin/impersonation/:id` | Session detail + role switch history |

### Permissions & Roles

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/permissions` | Full permission registry |
| `GET` | `/api/admin/permissions/matrix` | Built-in role × permission matrix (current effective state) |
| `PUT` | `/api/admin/permissions/roles/:role` | Update permission overrides for a built-in role |
| `GET` | `/api/admin/permissions/matrix/export` | Download matrix as CSV |

### Custom Roles

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/tenants/:id/roles` | Create custom role (owner or superadmin) |
| `GET` | `/api/tenants/:id/roles` | List custom roles for tenant |
| `PATCH` | `/api/tenants/:id/roles/:roleId` | Update custom role |
| `DELETE` | `/api/tenants/:id/roles/:roleId` | Delete custom role |

### Modules

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/modules` | List platform modules |
| `POST` | `/api/admin/modules` | Create platform module |
| `PATCH` | `/api/admin/modules/:id` | Update module |
| `DELETE` | `/api/admin/modules/:id` | Delete module |
| `GET` | `/api/tenants/:id/modules` | List modules available in tenant |
| `POST` | `/api/tenants/:id/members/:userId/modules` | Assign module to member |
| `DELETE` | `/api/tenants/:id/members/:userId/modules/:moduleId` | Remove module from member |

### User Management

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/api/admin/tenants/:id/members/:userId/role` | Override member role (superadmin only) |
| `PUT` | `/api/admin/users/:id/permissions` | Grant/revoke per-user permission overrides |
| `PUT` | `/api/admin/users/:id/status` | Activate / suspend |
| `POST` | `/api/admin/users/:id/force-logout` | Increment session_version; invalidates all tokens |
| `POST` | `/api/admin/users/:id/reset-password` | Send password reset email |
| `PUT` | `/api/admin/users/:id/mfa` | Disable/reset MFA (admin override) |

### Audit

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/audit-log` | Paginated audit log (filter by event, actor, target, date) |
| `GET` | `/api/admin/audit-log/export` | Export to CSV |

---

## 6. Frontend Components

| Component | Location | Description |
|---|---|---|
| `EmulationBar` | `components/admin/EmulationBar.tsx` | Fixed header banner; amber (impersonation) or blue (role preview); cannot be dismissed |
| `EmulationContext` | `contexts/EmulationContext.tsx` | React context: emulation state + `startEmulation`, `endEmulation`, `switchRole` helpers |
| `RolePreviewContext` | `contexts/RolePreviewContext.tsx` | Frontend-only context for role preview mode (no API calls) |
| `PermissionDebuggerProvider` | `contexts/PermissionDebuggerProvider.tsx` | Tracks all `PermissionGate` registrations; provides `debuggerActive` flag |
| `PermissionGate` | `components/auth/PermissionGate.tsx` | Wraps gated elements; renders border overlay + registers with debugger in debug mode |
| `PermissionDebuggerPanel` | `components/admin/PermissionDebuggerPanel.tsx` | Side drawer: Page / User / Role / Missing tabs; Copy All; Export CSV |
| `ImpersonateModal` | `components/admin/ImpersonateModal.tsx` | Confirmation modal with required Reason field and optional debugger checkbox |
| `RoleSwitcher` | `components/admin/RoleSwitcher.tsx` | Dropdown in EmulationBar; includes "Try any permission set" sandbox option |
| `RolePreviewDropdown` | `components/admin/RolePreviewDropdown.tsx` | Header dropdown for role preview mode (Super Admin only; outside impersonation) |
| `UserDetailDrawer` | `components/admin/UserDetailDrawer.tsx` | Sliding drawer: Profile / Tenants / Permissions / Sessions / Security tabs |
| `ModuleAssignmentPicker` | `components/admin/ModuleAssignmentPicker.tsx` | Module assignment UI with permission preview |
| `RolePermissionMatrix` | `components/admin/RolePermissionMatrix.tsx` | Editable role × permission grid with inline toggles; CSV export |
| `CustomRoleEditor` | `components/admin/CustomRoleEditor.tsx` | TEAMS-only; create/edit custom roles with permission checkboxes |
| `ActiveSessionsDashboard` | `components/admin/ActiveSessionsDashboard.tsx` | Live widget on admin home: active impersonation sessions with Terminate button |
| `AuditLogPage` | `app/admin/audit-log/page.tsx` | Filterable, paginated audit log; CSV export |

---

## 7. Data Model

### `admin_impersonation_sessions`
```sql
CREATE TABLE admin_impersonation_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id    UUID NOT NULL REFERENCES users(id),
  target_user_id   UUID NOT NULL REFERENCES users(id),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  role_override    VARCHAR(64) NOT NULL,
  reason           TEXT NOT NULL,              -- mandatory; stored immutably
  token_jti        VARCHAR(256) UNIQUE,        -- for immediate revocation
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  end_reason       VARCHAR(32),               -- MANUAL | EXPIRED | ADMIN_LOGOUT
  pages_visited    JSONB NOT NULL DEFAULT '[]',
  write_block_count INT NOT NULL DEFAULT 0,
  ip_address       INET,
  user_agent       TEXT,
  debugger_enabled BOOLEAN NOT NULL DEFAULT false
);
```

### `admin_impersonation_role_switches`
```sql
CREATE TABLE admin_impersonation_role_switches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES admin_impersonation_sessions(id),
  from_role   VARCHAR(64) NOT NULL,
  to_role     VARCHAR(64) NOT NULL,
  switched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `role_permission_overrides`
```sql
-- Stores deviations from the hardcoded default permission matrix.
-- granted=true means explicitly added; granted=false means explicitly removed.
CREATE TABLE role_permission_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role        VARCHAR(32) NOT NULL,           -- built-in role name
  permission  VARCHAR(128) NOT NULL,          -- resource:action
  granted     BOOLEAN NOT NULL,
  reason      TEXT,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, permission)
);
```

### `tenant_custom_roles`
```sql
CREATE TABLE tenant_custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        VARCHAR(64) NOT NULL,
  description TEXT,
  base_role   VARCHAR(32) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
```

### `platform_modules`
```sql
CREATE TABLE platform_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  base_role   VARCHAR(64),
  permissions JSONB NOT NULL DEFAULT '[]',
  is_builtin  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `tenant_modules`
```sql
CREATE TABLE tenant_modules (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  module_id UUID NOT NULL REFERENCES platform_modules(id),
  UNIQUE (tenant_id, module_id)
);
```

### `tenant_member_modules`
```sql
CREATE TABLE tenant_member_modules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  module_id  UUID NOT NULL REFERENCES platform_modules(id),
  granted_by UUID NOT NULL REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, module_id)
);
```

### `admin_audit_log`
```sql
CREATE TABLE admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event        VARCHAR(64) NOT NULL,
  actor_id     UUID REFERENCES users(id),
  target_user_id UUID REFERENCES users(id),
  tenant_id    UUID REFERENCES tenants(id),
  metadata     JSONB NOT NULL DEFAULT '{}',  -- event-specific payload
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No UPDATE or DELETE granted on this table
);
```

### Users table additions
```sql
ALTER TABLE users
  ADD COLUMN session_version INT NOT NULL DEFAULT 0;
-- Increment to instantly invalidate all JWTs for a user without a blocklist.
```

---

## 8. Security Requirements

1. **Backend enforcement on all admin routes**: `requireSuperAdmin` middleware applied to every `/api/admin/*` route as a blanket guard, not selectively.
2. **Database-backed Super Admin flag**: Migrate from hardcoded email to `users.isSuperadmin` flag, enabling multiple Super Admins without code changes.
3. **Emulation tokens are read-only**: `emu_readonly: true` causes middleware to reject all `POST`, `PUT`, `PATCH`, `DELETE` with `403` unless the endpoint is explicitly allow-listed (none in v1).
4. **Emulation tokens rejected by admin routes**: A token with `emu: true` must be rejected by all `/api/admin/*` routes — impersonation must not grant Super Admin access.
5. **Cannot impersonate a Super Admin**: Server rejects with `403` if target has `isSuperadmin: true`.
6. **No nested impersonation**: Starting a second session while one is active returns `409 Conflict`.
7. **Mandatory reason**: `reason` field is required and non-empty. Requests without it return `400 Bad Request`. The reason is stored immutably.
8. **1-hour token TTL**: Emulation tokens expire after 1 hour, non-renewable.
9. **Session version check**: Middleware validates JWT `session_version` matches `users.session_version`. Force Logout increments the counter, instantly invalidating all tokens.
10. **2FA requirement for Super Admin**: Impersonation endpoints block access if the requesting Super Admin does not have 2FA configured.
11. **No privilege escalation**: Emulation role cannot exceed the target user's plan entitlements. Custom role creation cannot grant permissions the creating admin does not hold.
12. **Audit log immutability**: `admin_audit_log` has no UPDATE or DELETE grants at the database level. Minimum retention: 12 months.
13. **Memory-only impersonation state**: Not written to localStorage. Page reload cleanly terminates the client-side session.

---

## 9. Observability & Alerting

### 9.1 Active Sessions Dashboard

A widget on the Admin Console home page showing:
- All currently active impersonation sessions (admin name, target user, tenant, start time, elapsed).
- Sessions in the last 24 hours with end reason.
- **Terminate Session** action per row: force-ends another admin's session (writes `IMPERSONATION_ENDED` with `end_reason: ADMIN_LOGOUT`).

### 9.2 Security Alerts

| Trigger | Threshold | Channel |
|---|---|---|
| Long impersonation session | Active > 30 minutes | Slack + email to designated security contact |
| Bulk permission change | > 10 users modified in < 5 minutes | Slack security alert |
| Failed impersonation attempts | > 3 `403` responses in 10 minutes from same admin | Slack security alert |
| Super Admin 2FA disabled | Any time | Immediate Slack + email |

### 9.3 Platform Metrics

| Metric | Purpose |
|---|---|
| `impersonation_sessions_started` | Daily count |
| `impersonation_session_duration_p50_p95` | Session length distribution |
| `impersonation_write_blocks_total` | Safety signal: how often admins attempt writes |
| `permission_debugger_opens` | Adoption signal |
| `role_assignments_created` | RBAC adoption |
| `module_assignments_created` | Module adoption |

---

## 10. Acceptance Criteria

### Emulation Bar
- [ ] Emulation bar appears in the header when an impersonation session is active (amber) or role preview is active (blue).
- [ ] Emulation bar shows: target user name, email, tenant, current role, active permission count, and elapsed session timer.
- [ ] Timer turns amber at 50 minutes.
- [ ] Emulation bar is not dismissable or minimizable. It is CSS-enforced.
- [ ] Browser tab title suffix shows current emulation context.
- [ ] "Copy Context" copies valid JSON to clipboard.
- [ ] Emulation bar is not visible to non-Super Admin users under any circumstance.
- [ ] Clicking "End Emulation" terminates the session, shows a toast with duration, and redirects to `/admin`.
- [ ] Navigating to a different route does not dismiss the emulation bar.

### Impersonation
- [ ] Super Admin can start a session from Users tab and from Tenants tab → member row.
- [ ] Confirmation modal requires a non-empty reason before allowing start.
- [ ] Attempting to impersonate a Super Admin returns 403 with explanation.
- [ ] Attempting to start a second session while one is active returns 409 with explanation.
- [ ] Emulation token contains `emu: true`, `emu_by`, `emu_sid`, `emu_readonly: true`.
- [ ] Emulation token is rejected by all `/api/admin/*` routes.
- [ ] All mutating API calls return 403 during impersonation.
- [ ] Impersonation state is NOT written to localStorage; page reload terminates client-side session.
- [ ] Token TTL warning toast appears at T-10 and T-5 minutes; session auto-ends at expiry.
- [ ] `IMPERSONATION_STARTED` and `IMPERSONATION_ENDED` audit events are written with reason and end reason.
- [ ] Target user sees "Recent Admin Access" entry in their Security settings after the session ends.

### Role Switcher
- [ ] Dropdown shows all built-in + custom roles for the active tenant.
- [ ] Switching roles re-issues a new emulation token and refreshes the current page in-place.
- [ ] Browser tab title suffix updates to reflect new role.
- [ ] Each role switch is logged in `admin_impersonation_role_switches`.
- [ ] "Try any permission set" sandbox allows ad-hoc permission composition with no DB write.

### Role Preview Mode
- [ ] "Preview as role" dropdown appears in header for Super Admins outside of impersonation.
- [ ] Selecting a role renders the blue bar and re-renders the current page with that role's permissions.
- [ ] No API call is made; data scope is unchanged.
- [ ] "Exit Preview" restores the Super Admin's own context.

### Permission Debugger
- [ ] Toggle (or `Ctrl+Shift+P`) activates colored borders on all `PermissionGate`-wrapped elements.
- [ ] Green / red dashed / yellow borders correctly reflect granted / denied / soft-gate states.
- [ ] Hover tooltip shows permission name, status, role requirement, grant source, and associated API endpoint.
- [ ] Side panel shows Page / User / Role / Missing tabs with correct data.
- [ ] "Copy All" and "Export CSV" produce correct output.
- [ ] Clicking a permission name in the panel navigates to the Roles & Permissions page.
- [ ] Debugger works in normal mode, during impersonation, and during role preview.

### Permission Schema & Custom Roles
- [ ] Role × permission matrix shows correct defaults in Admin Console → Roles & Permissions tab.
- [ ] Super Admin can toggle a permission for a built-in role; change persists to `role_permission_overrides`.
- [ ] Matrix can be exported as CSV.
- [ ] TEAMS tenants can create, edit, and delete custom roles.
- [ ] Custom role creation is blocked for FREE and PRO tenants.
- [ ] Custom role cannot grant permissions the creating admin does not hold.

### Per-User Permission Overrides
- [ ] Super Admin can grant or revoke individual permissions for a user within a tenant.
- [ ] "Effective Permissions" section shows the correctly resolved final permission set.
- [ ] Last 10 changes are shown in the user drawer with actor and timestamp.

### Role Assignment Expiry
- [ ] Super Admin can set an expiry date when assigning a role.
- [ ] System auto-revokes the role at expiry and writes `USER_ROLE_EXPIRED`.

### Modules
- [ ] Super Admin can create a platform module with name, description, min role, and permission list.
- [ ] Assigning a module shows a permission preview before confirmation.
- [ ] Module assignment adds permissions to effective permission set (visible in Permission Debugger).
- [ ] Removing a module revokes permissions, with conflict warning if base role also grants them.

### User Management
- [ ] Global user search works across all tenants.
- [ ] User detail drawer shows tenant memberships, roles, modules, and effective permissions.
- [ ] Super Admin can change a user's role in a tenant from the drawer.
- [ ] Force Logout increments `session_version` and invalidates all tokens.
- [ ] Force Password Reset sends a reset email and writes an audit event.
- [ ] MFA Disable is gated by a confirmation modal and writes an audit event.

### Audit Log
- [ ] All events in §4.11 are written to `admin_audit_log`.
- [ ] Audit log is filterable by event type, actor, target user, date range.
- [ ] Audit log is exportable as CSV.
- [ ] No UPDATE or DELETE on `admin_audit_log` is possible via any API endpoint.

### Security
- [ ] Non-Super Admin users receive 403 on all `/api/admin/*` routes.
- [ ] Super Admin without 2FA cannot start an impersonation session.
- [ ] All acceptance criteria above produce the correct audit log entries.

---

## 11. Implementation Phases

### Phase 1 — Security Foundation
1. Add `requireSuperAdmin` middleware to all `/api/admin/*` routes (blanket guard).
2. Migrate `superAdminMiddleware` from hardcoded email to `users.isSuperadmin` flag.
3. Add `session_version` to `users` table; validate in auth middleware.
4. Write `admin_audit_log` table and begin writing audit events to existing admin endpoints.

### Phase 2 — Impersonation Core
1. `admin_impersonation_sessions` + `admin_impersonation_role_switches` tables + migration.
2. `POST /api/admin/impersonation/start` (with reason field) and `POST .../end`.
3. Frontend emulation state management (memory-only, React context).
4. `EmulationBar` component (amber variant) + `ImpersonateModal` with reason field.
5. Emulation token `emu_readonly` enforcement in API middleware.
6. "Impersonate" action on user rows and tenant member rows.
7. `IMPERSONATION_STARTED / ENDED / EXPIRED / WRITE_ATTEMPT_BLOCKED` audit events.

### Phase 3 — Permission Debugger
1. `PermissionDebuggerProvider` context + `PermissionGate` component.
2. Update all existing conditional `hasRole()` / `hasPermission()` checks to use `<PermissionGate>`.
3. `PermissionDebuggerPanel` (Page / User / Role / Missing tabs; Copy All; Export CSV).
4. DOM element overlay (colored borders + hover tooltips with API endpoint annotation).
5. Header toggle button + `Ctrl+Shift+P` shortcut (Super Admin only).

### Phase 4 — Role Preview Mode
1. `RolePreviewContext` (frontend-only).
2. `RolePreviewDropdown` in header.
3. Blue Emulation Bar variant.

### Phase 5 — In-Session Role Switcher
1. `POST /api/admin/impersonation/:id/switch-role`.
2. `RoleSwitcher` dropdown in EmulationBar.
3. "Try any permission set" sandbox modal.
4. Browser tab title suffix updates.

### Phase 6 — Granular Permissions & Custom Roles
1. `role_permission_overrides` table + migration.
2. `GET/PUT /api/admin/permissions/matrix`.
3. `tenant_custom_roles` table + custom role CRUD endpoints.
4. `RolePermissionMatrix` component (editable, CSV export).
5. `CustomRoleEditor` component.

### Phase 7 — Modules
1. `platform_modules`, `tenant_modules`, `tenant_member_modules` tables + migration.
2. Module CRUD endpoints + module assignment endpoints.
3. `ModuleAssignmentPicker` + module preview modal.
4. `ModulesManagementPage` in admin console.

### Phase 8 — Enhanced User Management
1. Per-user permission overrides (grant/revoke on tenant membership).
2. Role assignment expiry (`USER_ROLE_EXPIRY_SET / EXPIRED` events).
3. Force Logout, Force Password Reset, MFA Disable endpoints + drawer actions.
4. User Security tab with admin access log.
5. Bulk operations (suspend / assign module / export) + `BULK_OPERATION` audit event.

### Phase 9 — Observability & Target Transparency
1. Active Impersonation Sessions widget on admin home.
2. "Terminate Session" action (force-end another admin's session).
3. Security alerts (Slack/email) for long sessions, bulk changes, failed attempts, 2FA disabled.
4. Platform metrics (impersonation counts, duration, write blocks, debugger opens).
5. Target user "Recent Admin Access" in Account Settings → Security.

---

## 12. Open Questions

| # | Question | Owner | Due |
|---|---|---|---|
| OQ-1 | Should tenant Owners be able to see an impersonation log for their own tenant? | Product | — |
| OQ-2 | Should module assignment be self-service for tenant Owners, or always require Super Admin? | Product | Before Phase 7 |
| OQ-3 | Should module definitions be importable/exportable as JSON for cross-environment parity? | Engineering | — |
| OQ-4 | Is there an appetite for delegated impersonation (tenant Owner impersonates their members)? | Product | — |
| OQ-5 | Should emulation sessions have a configurable max TTL, or is 1 hour always sufficient? | Product | — |
| OQ-6 | Should users receive a real-time notification when an admin accesses their account, or only a post-session security log entry? Real-time risks tipping off a fraud subject. | Legal/Product | Before Phase 9 |
| OQ-7 | What is the required audit log retention period? SOC 2 recommends ≥ 12 months; GDPR may require deletion of personal data after a period. These create a conflict that Legal must resolve. | Legal | Before Phase 1 |
| OQ-8 | Should impersonation be time-restricted (e.g., only during business hours in the target user's timezone)? | Security | — |
| OQ-9 | Should the platform send an alert if a Super Admin starts an impersonation session without 2FA configured — or hard-block? | Security | Before Phase 2 |
| OQ-10 | Should write-through impersonation (allowing writes) be a per-tenant setting or a global Super Admin setting in a future v2? | Product | — |

---

## 13. Out of Scope (Future)

- Delegated impersonation for tenant Owners
- Automated permission regression testing (CI gate that validates `PermissionGate` coverage)
- Permission-level rate limiting (distinct from plan-level rate limiting)
- Attribute-based access control (ABAC) beyond role + module grants
- User-facing "who can see this?" tooltip (distinct from Super Admin debugger)
- Row-level security beyond existing tenant data isolation
- Real-time permission streaming / WebSocket permission refresh
- Tenant self-service custom role builder (post-v1)
