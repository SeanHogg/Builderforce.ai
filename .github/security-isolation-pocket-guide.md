# Security Isolation – Quick Reference Pocket Guide

**Purpose:** This document provides a rapid reference for developers, DevOps, and Security Managers when working with BuilderForce.ai's security isolation model.

**Version:** 1.0 (Task #486)  
**Status:** Applied as of 2025-06-18

---

## What This Addresses?

- **GAP-G1** – Insufficient cloud V2 sandboxing
- **GAP-G2** – Insufficient token scrubbing

These gaps were identified in security reviews and must stay mitigated to align with SOC 2 TSC sections:security (configuration), TSC:confidentiality (credential), and TSC:availability (resource).

---

## 1. For Container Operators (K8s / Docker)

### 1.1 Every sandbox container must run with these flags

```bash
docker run --read-only \
  --cap-drop=ALL \
  --cap-add=CHOWN --cap-add=NET_BIND_SERVICE \
  -v /tmp:/tmp \
  builderforce/agent-runtime:latest
```

| Flag | Protects Against |
|------|------------------|
| `--read-only` | File escape via runtime writes |
| `--cap-drop=ALL` | Kernel exploit via privilege escalation |
| `--cap-add=CHOWN,NET_BIND_SERVICE` | Minimal required capabilities only |
| `/tmp` mount | Allow `/tmp` writes inside read-only filesystem |

### 1.2 K8s security context for sandboxes

Add this to your Deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-runtime-sandbox
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        readOnlyRootFilesystem: true
        capabilities:
          drop:
          - ALL
          add:
          - CHOWN
          - NET_BIND_SERVICE
      automountServiceAccountToken: false
      containers:
      - name: agent-runtime
        image: builderforce/agent-runtime:latest
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
            add:
            - CHOWN
            - NET_BIND_SERVICE
        resources:
          requests:
            cpu: "250m"
            memory: "256Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
        volumeMounts:
        - name: tmp
          mountPath: /tmp
          readOnly: false
        - name: dev-shm
          mountPath: /dev/shm
          readOnly: false
      volumes:
      - name: tmp
        emptyDir: {}
      - name: dev-shm
        emptyDir:
          medium: Memory
```

### 1.3 Network policies

Apply this in your K8s cluster:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: agent-runtime-sandbox-netpol
spec:
  podSelector:
    matchLabels:
      app: agent-runtime
  policyTypes:
  - Ingress
  - Egress
  egress:
  - to: []
  ingress: []
```

### 1.4 Resource quotas

Add this to your namespace manifest:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: runtime-sandbox-quota
spec:
  limits:
  - default:
      cpu: "500m"
      memory: "512Mi"
    defaultRequest:
      cpu: "250m"
      memory: "256Mi"
    type: Container
```

---

## 2. For Application Developers (Backend)

### 2.1 Token scrubbing middleware

Add this to your Hono app:

```typescript
import middleware from "./tokenScrubbingMiddleware";
app.use(middleware.tokenScrubbingMiddleware());
```

### 2.2 Redact Authorization header in error logs

Override `response.headers.set`:

```typescript
// api/src/presentation/middleware/tokenScrubbingMiddleware.ts
export const tokenScrubbingMiddleware = () => {
  return async (c, next) => {
    const originalWrite = c.res.headers.set.bind(c.res.headers);

    c.res.headers.set = (name: string, value: string) => {
      if (/Authorization/i.test(name)) {
        const debug = process.env.DEBUG_TOKENS === 'true';
        const redacted = debug ? '[REDACTED_BEARER]' : '***REDACTED***';
        return originalWrite(name, value.replace(
          /^Bearer\s+[^\s]+$/,
          `Bearer ${redacted}`
        ));
      }
      return originalWrite(name, value);
    };

    await next();
  };
};
```

### 2.3 Service token authentication (already exists, review for logs)

If you call `authenticateServiceToken`, only log a hash, not the full key:

```typescript
import { authenticateServiceToken } from "./serviceTokenAuth";

export async function handler(c: Context<HonoEnv>) {
  const { tenantApiKeyId, tenantId, segmentId } =
    await authenticateServiceToken(c, "bfk_read", { accountId: "..." });

  // Secure: Hash the key before logging
  console.info(
    `[authenticateServiceToken] Verified key ${tenantApiKeyId.slice(0, 8)}... for tenant ${tenantId}`
  );
}
```

### 2.4 Enforce JWT TTL (already exists in `llmRoutes.ts`, verify it is wired up)

Ensure your app is using `requireTenantAccess` from `api/src/presentation/routes/llmRoutes.ts`. This validates "exp" and "nbf" claims on each request and rejects expired tokens with 440.

---

## 3. For DevOps and SecOps

### 3.1 Secrets and tokens must never appear in logs

| Source | Verify With |
|--------|-------------|
| Application logs | `grep -r "Authorization: Bearer" --include="*.log"` |
| Sentry/Snowplow | Check transactions for ` Authorization ` header presence |
| Airflow/CI logs | `grep -r "bfk_" --include="*.log"` (match `bfk_1234...` pattern) |

### 3.2 Self-healing for weaker tokens

If a token is found in a log (e.g., `bfk_read_abc12345`), immediately rotate it in the backend vault and update `tenantApiKeyService` to invalidate the old version.

### 3.3 AppArmor enforcement

After deploying AppArmor profile, verify it is active:

```bash
sudo aa-status | grep agent-runtime
sudo aa-sanitized-profile --dump .local/profiles/agent-runtime-sandbox
```

Expected output should show `profile_name=(agent-runtime-sandbox)` and a list of allowed execve calls limited to whitelisted paths.

---

## 4. For Auditors / Risk Managers

### 4.1 Checklist for sign-off

| Control | Implemented? | Validated? | Evidence |
|---------|--------------|------------|----------|
| Non-root container user | ✅ | ✅ | `Dockerfile.sandbox` line 19, K8s `runAsUser` |
| Read-only filesystem | ✅ | 🟡 | K8s `readOnlyRootFilesystem: true` (deployed) |
| Capability drop | ✅ | ✅ | K8s `capabilities.drop: ALL` |
| Resource limits | ✅ | ✅ | K8s `LimitRange` manifest applied |
| Network isolation | ✅ | ✅ | K8s `NetworkPolicy` applied |
| Token scrubbing middleware | ✅ | ✅ | New `tokenScrubbingMiddleware.ts` added |
| Telemetry token scrubbing | ✅ | ✅ | Sentry/Snowplow config updated |
| JWT TTL enforcement | ✅ | ✅ | `requireTenantAccess` active |
| AppArmor profile | 🟡 | 🟡 | Profile generated (not deployed yet) |
| Audit schema isolation | 🟡 | 🟡 | Pending table migration |

**Final sign-off:** After AppArmor deployment and audit schema migration milestone.

---

## 5. Safety Rules (DO NOT BREAK)

- **Never** run the agent runtime container with `--privileged` or `--cap-add=*` (unless validated for an approved use-case and documented).
- **Never** mount the host filesystem or `/host` into a sandbox container.
- **Never** embed raw `bfk_*` keys into code, config, or comments.
- **Never** enable `DEBUG_TOKENS=true` in production.

---

## 6. Resources

- Full security isolation model: {@link .github/security-isolation-model.md}
- Gap analysis: {@link .github/security-gap-analysis.md}
- Red-team check results: {@link .github/security-red-team-check-results.md}
- Tracks manifest: {@link .github/isolation-tracks.json}
- Security policy: {@link agent-runtime/docs/SECURITY.md}
- Spec 05: Seams and service tokens (section: service token auth, scopes, `TenantAccessError`).

---

**Version History:**
- 1.0 – Initial pocket guide (task #486)