# Security Isolation Model

**Document Version:** 1.0  
**Status:** Effective as of task #486  
**Owner:** BuilderForce Security Team

## 1. Executive Summary

This document defines the security isolation model for BuilderForce.ai, establishing clear security boundaries, assets, and data flows to protect cloud assets and sensitive data. The model addresses two critical gaps identified in task #486: GAP-G1 (cloud V2 sandboxing) and GAP-G2 (token scrubbing).

## 2. Security Boundaries

### 2.1 Primary Isolation Dimensions

| Dimension | Description | Impact if Compromised |
|-----------|-------------|----------------------|
| **Process Isolation** | Containers / sandboxes run with restricted permissions, non-root users, and minimal capabilities | Escalation of privileges, container breakout |
| **Network Isolation** | Container networking limited to loopback or specific pod CIDRs | Cross-subnet access, lateral movement |
| **Data Isolation** | Persistent storage separated per tenant/sandbox; runtime in-memory only for sensitive tokens | Data leakage, unauthorized access |
| **Resource Isolation** | CPU/memory limits prevent DoS; container-level quota enforcement | Resource exhaustion, unfair resource allocation |
| **Identity Isolation** | Tenant-scoped API keys and JWT tokens with least-privilege scopes | Token theft, privilege escalation |
| **Audit Isolation** | Immutable audit trail separated from runtime state | Tampering with evidence, forensic failure |

### 2.2 Track-Level Boundaries

Based on `.github/isolation-tracks.json`, the system is partitioned into ten tracks:

| Track | Charge | Migration Band | Responsible Discipline |
|-------|--------|----------------|------------------------|
| **T1 – Marketing & SEO** | Sean Hogg | None | Marketing / Product |
| **T2 – App UI & Brain** | Sean Hogg | 0180–0189 | Frontend / Product |
| **T3 – Gateway & LLM** | Sean Hogg | 0130–0139 | API Gateway / AI Ops |
| **T4 – Cloud Runtime & PR** | Sean Hogg | 0140–0149 | Cloud Infrastructure |
| **T5 – On-Prem Runtime** | Sean Hogg | None | DevOps / SRE |
| **T6 – Studio & Voice** | Sean Hogg | 0150–0159 | Frontend / AI Ops |
| **T7 – Tenant · Embed · Gov** | Sean Hogg | 0160–0169 | Security / Privacy |
| **T8 – Workflows · Boards** | Sean Hogg | 0170–0179 | Product / Engineering |
| **T9 – Platform · DB · CI** | Sean Hogg | 0190–∞ | DevOps / Security |
| **T10 – Docs & QA** | Sean Hogg | None | Documentation / QA |

**Shared Hubs:** `api/infrastructure/database/schema.ts`, `api/index.ts`, `frontend/lib/builderforceApi.ts`, `README.md`, `package.json` (api & frontend).

## 3. Security Controls and Impact

### 3.1 Container Sandbox Hardening (addresses GAP-G1)

| Control | Implementation | Enforcement Layer | Failure Impact | Action Required |
|---------|----------------|-------------------|----------------|-----------------|
| **Non-root user** | `USER sandbox` in Dockerfile | Container runtime | Root exit → host compromise | ✅ **REQUIRED** |
| **Read-only filesystem** | `--read-only` flag + volume mounts | Docker runtime | Runtime writes → RCE if escape | ✅ **REQUIRED** |
| **Capability drop** | `--cap-drop=ALL` | Docker runtime | Unrestricted syscalls | ✅ **REQUIRED** |
| **Resource limits** | CPU/mem quotas | Kubernetes/K8s | DoS of other containers | ✅ **REQUIRED** |
| **Network isolation** | Pod networks + service meshes | K8s network policies | Unrestricted pod-to-pod | ✅ **REQUIRED** |
| **Security profiles** | AppArmor/profiles; Seccomp | Host kernel | Kernel exploit via syscalls | **IN PROGRESS** |

**Impact Score:** Critical  
**Rationale:** These controls prevent privilege escalation from compromised containers and limit the attack surface for escape attempts.

### 3.2 Token Scrubbing (addresses GAP-G2)

| Control | Implementation | Enforcement Layer | Failure Impact | Action Required |
|---------|----------------|-------------------|----------------|-----------------|
| **Header sanitization** | Strip `Authorization: Bearer` from logs/telemetry | Middleware layer | Token leakage in logs | ✅ **REQUIRED** |
| **Header redaction** | Replace with `[REDACTED_BEARER]` in privileged logs | Middleware layer | Token leakage in debug | ✅ **REQUIRED** |
| **Context token isolation** | Store tokens in memory-only caches (e.g., fastify memory store) | Application layer | Disk exposure if escaped | ✅ **REQUIRED** |
| **Short-lived tokens** | JWT TTL enforced; rotate on framework-ready events | Application layer | Credential reuse | ✅ **REQUIRED** |
| **Scope enforcement** | Least-privilege scopes in tenant API keys | Application layer | Token over-claiming | ✅ **REQUIRED** |
| **Audit logging** | Immutable, tenant-isolated audit trail | Database layer | No evidence of token usage | **BONUS** |

**Impact Score:** High  
**Rationale:** Token scrubbing prevents credential harvesting from transit and at-rest artifacts.

### 3.3 Cross-Domain Seam Protection

| Control | Implementation | Enforcement Layer | Failure Impact |
|---------|----------------|-------------------|----------------|
| **Service token auth** | `authenticateServiceToken()` with tenant API key (`bfk_*`) only | Middleware layer | JWT misuse in seams |
| **Scope verification** | `keyHasScope()` checks `TenantApiScope` | Middleware layer | Over-authorized service calls |
| **Segment resolution** | Verify tenantId + segmentId alignment | Application layer | Unauthorized cross-tenant access |

## 4. Data Flow and Asset Protection

### 4.1 Critical Data Classes

| Class | Living Location | Protection Mechanism | Sensitivity |
|-------|-----------------|---------------------|-------------|
| **End-user JWTs** | HTTP request headers (in-transit) | HTTPS TLS 1.3, hostname pinning | PII + session |
| **Tenant API keys** | Bearer header (in-transit) + keyring (at-rest) | Long TTL validated per request | PII + scoped perms |
| **Segment tokens** | In-memory cache per container process | Container isolation | Analytics |
| **Execution tokens** | In-memory cache per agent | `egl` or `ephemeral` secrets | Execution scope |
| **Local agent tokens** | Keychain on host machine | OS-level keychain | Infrastructure access |
| **Database credentials** | Environment variables + IAM roles | K8s secrets, rotation enforced | Full database access |
| **GitHub/GitLab tokens** | Config file (local) + at-rest in KV store | RBAC scoped to repo owners | Repo write access |
| **Build runner credentials** | Procfile builds or agent env vars | Procfile trusts mitigated with workspace-only writes | CI/CD access |

### 4.2 Data Flow Diagram

```
External Request
    ↓
Gateway (TLS termination)
    ↓
Authentication Middleware (JWT or bfk_*)
    ↓  (resolve tenantId/segmentId)
Per-Tenant Isolation
    ├─ Config store
    ├─ Segment server
    ├─ Runtime state
    └─ Audit log (write-only)
    ↓
Service Token Auth (for seam calls)
    ├─ Validate bfk_* key scope
    └─ Resolve Segment coordinates
    ↓
Business Logic (per-track isolation enforced by track-scope guard)
    ↓
LLM Gateway / Runtime
    ↓
Response
```

**Isolation checkpoints:**
1. TLS termination separates external network from internal services.
2. Per-tenant isolation separates tenant data at database query and cache levels.
3. Track-scope guard (check-track-scope.mjs) enforces per-track ownership during migration.
4. Service tokens enforce that seams cannot impersonate user tokens (MTLS per spec05 §2.3).

## 5. Governance and Operations

### 5.1 Roles and Responsibilities

| Role | Primary Duty | Oversight |
|------|--------------|-----------|
| **Cloud Security Manager** | Monitor cloud resource permissions, enforce sandbox controls | CISO / Security Lead |
| **IaC Engineer** | Enforce container hardening in Dockerfiles, K8s manifests, Terraform | DevOps / Infrastructure |
| **Compliance & Risk Manager** | Verify isolation model compliance with SOC 2 TSC:security | Internal Audit |

### 5.2 Life Cycle

1. **Design Review:** Security model included in architecture reviews, track manifests updated.
2. **Implementation:** Code (middleware/Dockerfiles) written using least-privilege defaults.
3. **Build:** CI/CD runs `check-track-scope.mjs` and infra-quality checks.
4. **Deploy:** K8s/Ansible enforces non-root, read-only filesystem, capability drop.
5. **Runtime:** Monitoring/alerting for sandbox status; logs redact tokens.
6. **Rotate:** Tokens rotated periodically; credentials rotated via vault/console.

### 5.3 Continuous Improvement

- Monthly security health checks (`builderforce security audit --deep`)
- Quarterly red-team exercises (GAP addressing)
- Annual intrusion-detection testing
- OIDC/OpenID Connect compliance verification (if adding external auth)

## 6. Compliance Mapping

This model directly satisfies the following Trust Service Criteria (TSC) sections:

| TSC | Section | Addressed by |
|-----|---------|--------------|
| **security** | Configuration management (migration 0070) | Track ownership, scaffold guard, service token scopes |
| **availability** | Resource isolation (workload availability) | Container quotas, network isolation |
| **processing_integrity** | Least-privilege and audit trails | Service token auth, audit log isolation |
| **confidentiality** | Credential management | TLS, token scrubbing, endpoint scopes |
| **privacy** | PII handling within environment | Tenant ID isolation, segment server enforces per-account scope per spec 05 §2.3 |

---

## 7. References

- {@link .github/isolation-tracks.json} – Tracks manifest source of truth.
- {@link .claude/settings.json} – Project-level isolation settings.
- {@link docs/SECURITY.md} – Security policy and incident response.
- {@link .detect-secrets.cfg} – Secret detection baseline.
- Specification 05: Cross-Domain Seams documentation (spec05 §2.3).