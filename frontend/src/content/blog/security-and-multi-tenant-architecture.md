---
title: Security and Multi-Tenant Architecture — How Builderforce Keeps Your Work Isolated
date: 2026-03-16
description: A deep dive into how Builderforce.ai handles multi-tenancy, role-based access control, session security, audit trails, and the trust model for CoderClaw agent authentication.
tags: [security, multi-tenant, rbac, audit, authentication, compliance]
author: Sean Hogg
---

# Security and Multi-Tenant Architecture — How Builderforce Keeps Your Work Isolated

Every team on Builderforce shares the same API infrastructure. No team can see another team's projects, agents, tasks, or conversations. This isolation is not a feature that is bolted on — it is the fundamental architectural assumption that every database query, every API route, and every agent dispatch is built around.

This post explains the trust model, the access control system, how agent authentication works, and what the audit trail covers.

---

## The Tenant Model

A **tenant** is your organisation's isolated workspace on Builderforce. All resources — projects, tasks, claws, agents, skills, approvals, conversations — are scoped to a tenant. There is no cross-tenant visibility or sharing.

Users belong to one or more tenants with a specific **role** in each:

| Role | What they can do |
|---|---|
| `viewer` | Read-only access to projects, tasks, chat history, and observability |
| `developer` | Read + write access to projects and tasks; can interact with the IDE and chat |
| `manager` | Full developer access plus: approve/reject gates, manage claw instances, assign skills, manage members |
| `owner` | Full manager access plus: billing, tenant deletion, source control integrations |

Roles are enforced at the API layer — every protected endpoint checks the caller's role against the required minimum before processing the request. A developer attempting to approve an approval gate receives a `403`.

---

## Authentication

Builderforce uses a **dual-token authentication model** designed to cleanly separate browser sessions from agent API access.

### Web JWT (User Sessions)

Browser-based users authenticate with email and password and receive a short-lived JWT. The token encodes:

- `userId` — the authenticated user
- `tenantId` — the tenant context for this session
- `role` — the user's role in that tenant
- `exp` — expiry (short-lived; refreshable)

All JWT operations go through the `/api/auth` routes. Tokens can be individually revoked from the Security settings page.

### Multi-Factor Authentication

Users can enable TOTP-based MFA from [Settings → Security](/security). Once enabled, every login requires the TOTP code in addition to the password.

Recovery codes are generated at MFA enable time — store them securely. They are hashed immediately and cannot be retrieved.

### Claw API Keys

CoderClaw instances do not use JWTs. Each registered claw receives a **one-time plaintext API key** at registration time. The key is hashed immediately and the plaintext is never stored — if you lose it, you generate a new one.

The claw sends this key via `Authorization: Bearer <key>` on every request. The API verifies it against the stored hash and resolves the tenant context from the claw's registration record.

**Keys never appear in URLs.** This was a historical pattern in some Builderforce endpoints that has been migrated — all claw-authenticated endpoints now use the `Authorization` header only, keeping keys out of server access logs and CDN caches.

---

## Session Management

Every active browser session is tracked in the `auth_user_sessions` table. Managers can view and revoke sessions for any user in their tenant from the Security panel.

The sessions view shows:

| Field | Value |
|---|---|
| Session ID | Unique identifier |
| User agent | Browser and OS |
| IP address | Last seen IP |
| Created at | Session start time |
| Last active | Last authenticated request |
| Status | Active or revoked |

Revoking a session invalidates all tokens issued within it. The user is logged out on their next request.

---

## CoderClaw Trust and Dispatch Security

The claw mesh introduces an additional trust surface: claw-to-claw dispatch. When Claw A sends a task to Claw B, Claw B needs to verify the request actually came from Claw A — not from an attacker who discovered Claw B's endpoint.

Builderforce uses **HMAC-SHA256 payload signing** for all inter-claw dispatch:

```
Claw A sends:
  POST /api/claws/:id/forward
  Authorization: Bearer <clawApiKey>
  X-Claw-Signature: sha256=<hmac>
  X-Claw-From: <sourceClawId>
  Body: { task: "..." }
```

The HMAC is computed over the raw request body using the sending claw's API key as the secret. The receiving claw (via Builderforce's `verifyClawSignature`) recomputes the HMAC and compares. A mismatch returns `403` before the payload is processed.

If no signature is present, Builderforce accepts the request for backward compatibility — but logs the absence. In a future hardening release, the absence of a signature on forwarded tasks will become a hard rejection.

---

## The Audit Log

Every significant action in Builderforce is recorded in the **audit log** — accessible at [/admin](/admin) for owners and managers.

The audit log captures:

| Event type | What triggered it |
|---|---|
| `tenant.member_added` | User added to tenant |
| `tenant.member_removed` | User removed from tenant |
| `claw.registered` | New CoderClaw instance created |
| `claw.status_changed` | Claw activated, deactivated, or suspended |
| `approval.created` | Agent requested an approval gate |
| `approval.decided` | Manager approved or rejected |
| `task.created` | Task created on the board |
| `execution.submitted` | Task submitted for execution |
| `execution.state_changed` | Execution moved to running/completed/failed |
| `project.created` | New project created |
| `skill.assigned` | Skill assigned to tenant or claw |

Each event records: who, what, when, which resource (type and ID), and structured metadata.

### Tool Audit Events

Separate from the tenant audit log, the **tool audit log** records every tool call made by a CoderClaw agent: the tool name, input arguments, result, duration, and whether it succeeded or errored. This log is the ground truth for "what did the agent actually do" — useful for debugging and for compliance reviews.

---

## Data Isolation Architecture

Multi-tenant isolation is enforced at the database query level — not at the application logic level.

Every query against a tenant-scoped table includes an explicit `tenantId` condition:

```typescript
const rows = await db
  .select()
  .from(projects)
  .where(
    and(
      eq(projects.tenantId, tenantId),  // always present
      eq(projects.status, 'active'),
    )
  );
```

There is no "select all" path that omits the tenant filter. Even if the application logic had a bug, the query would not return another tenant's data.

CoderClaw instances are also tenant-scoped — a claw registered to Tenant A cannot receive tasks from Tenant B's dispatch, cannot appear in Tenant B's fleet view, and cannot read Tenant B's project context.

---

## Privacy Controls

Builderforce supports GDPR and CCPA compliance requests. Users can submit a data deletion or access request from their account settings, or a manager can submit on their behalf.

Privacy requests are tracked through a formal workflow:

```
submitted → in_review → completed / closed
```

All personal data associated with the request (chat history, audit events, usage snapshots) can be deleted on request in accordance with the applicable regulation.

---

## Source Control Security

When you connect a GitHub or Bitbucket account via the source control integration, Builderforce stores only:

- The account identifier (org/username)
- The host URL (for self-hosted GitHub Enterprise)
- The integration type

No OAuth tokens or PATs are stored in Builderforce's database. Token management is handled by the CoderClaw instance that performs the git operations.

---

## Security Roadmap

Several security enhancements are planned for Phase 2 and beyond:

- **Mandatory HMAC signatures** — reject unsigned inter-claw dispatch with no backward-compat window
- **Device trust** — register trusted devices; require re-authentication from new devices
- **IP allowlists** — restrict tenant access to specific CIDR ranges
- **SSO** — SAML and OIDC for enterprise identity providers
- **SIEM export** — stream audit events to external log systems via OTel

---

## Best Practices

**Rotate claw API keys quarterly.** A key that has never been rotated is a key that has potentially been sitting in a shell history file for months. Register a new key, update the claw's environment variable, restart the claw, and revoke the old key.

**Use the minimum role necessary.** Developers do not need `MANAGER` access. Reviewers do not need `DEVELOPER` access. Role assignment should match actual responsibility.

**Enable MFA for all managers and owners.** Developer accounts with read/write access are valuable targets; manager accounts that can approve destructive actions are more so.

**Review the tool audit log after any unexpected agent behaviour.** Before re-running a workflow that produced surprising output, read what the agent actually did — the tool audit log is the authoritative record.

---

## Next Steps

- Review your team's role assignments in [Settings → Members](/settings)
- Enable MFA from [Settings → Security](/security)
- Check the [Audit Log](/admin) for recent significant events on your tenant
- Read [Approval Gates and Human Oversight](/blog/approval-gates-and-human-oversight) for the human-in-the-loop controls that complement platform security
