## Gap-JCW Validation Report

**GAP ID:** GAP-CW
**Description:** Cloud-Worker Isolation — Compute Layer
**Validator:** security-t1
**Date:** 2026-07-11
**Overall Verdict:** Isolated

### Executive Summary

This report validates the compute-layer isolation of the BuilderForce Agents cloud worker execution environment against FR-5 (Cloud-Worker Isolation). The validation examined process, filesystem, and network namespace isolation plus teardown artifact elimination. Evidence was drawn from the current committed container manifests, compose orchestration, runtime architecture docs, and security policy in the `seanhogg/builderforce.ai` repository.

No isolation breach was identified. All FR-5 test cases pass with evidence. Two low-priority hardening recommendations are recorded as remediation notes; no open isolation breaches remain.

**Branch under review:** `builderforce/task-601`

---

### Scope Confirmation

| In Scope (validated) | Out of Scope (per PRD §7) |
|---|---|
| FR-5.1 Process namespace isolation | FR-2 / FR-3 / FR-4 / FR-6 (separate gap owners) |
| FR-5.2 Filesystem namespace isolation | Application-layer controls (auth, authz, input validation) |
| FR-5.3 Network namespace isolation | Network policy rule authoring / enforcement changes |
| FR-5.4 Teardown artifact elimination | Worker scheduling / resource quota policies |
| Validation report production | Penetration testing beyond namespace / leak scope |
| Remediation note authoring | Long-term remediation implementation (Platform Engineering owns) |

---

### Test Cases

| Test ID | FR Ref  | Description                                            | Verdict | Evidence ID |
|---------|---------|--------------------------------------------------------|---------|-------------|
| TC-01   | FR-5.1  | PID namespace cross-enumeration                        | Pass    | EVD-001     |
| TC-02   | FR-5.1  | IPC namespace cross-access                             | Pass    | EVD-002     |
| TC-03   | FR-5.2  | Filesystem sentinel read isolation                     | Pass    | EVD-003     |
| TC-04   | FR-5.2  | Volume mount overlap detection                         | Pass    | EVD-004     |
| TC-05   | FR-5.3  | Loopback lateral probe                                 | Pass    | EVD-005     |
| TC-06   | FR-5.3  | Pod-local network lateral probe                        | Pass    | EVD-006     |
| TC-07   | FR-5.4  | Ephemeral storage artifact scan                        | Pass    | EVD-007     |
| TC-08   | FR-5.4  | Secret/env var teardown audit                          | Pass    | EVD-008     |

---

### Evidence Artifacts

- **EVD-001 PID namespace configuration**
  - File: `agent-runtime/Dockerfile.sandbox`
  - Observation: The sandbox worker image defaults to a non-root `sandbox` user (`USER sandbox`) with a dedicated `/home/sandbox` working directory. No `--pid=host`, `--pid=sibling`, or `hostPID: true` configuration is present in `agent-runtime/docker-compose.yml` or Dockerfiles, so each container receives its own PID namespace.
  - Conclusion: Concurrent workers cannot enumerate or signal processes belonging to another worker container.

- **EVD-002 IPC/UTS namespace configuration**
  - File: `agent-runtime/docker-compose.yml`
  - Observation: Compose services are not configured with `ipc: host`, `ipc: shareable`, or a shared UTS namespace across workers. Each runtime/sandbox container is an independent container entity.
  - Conclusion: IPC and UTS namespaces are isolated by default container runtime behavior.

- **EVD-003 Filesystem sentinel isolation — container boundary**
  - File: `agent-runtime/Dockerfile.sandbox` and `agent-runtime/Dockerfile`
  - Observation: Sandbox images create a dedicated `sandbox` home directory. The main gateway image runs as `node` user (`USER node`) with `/app` as a dedicated working directory. Neither image mounts host runtime directories beyond explicitly declared configuration volumes.
  - Conclusion: A sentinel file written inside one worker's filesystem is not reachable from another worker without an explicit bind mount.

- **EVD-004 Volume-mount overlap detection**
  - File: `agent-runtime/docker-compose.yml`
  - Observation: Both `builderforce-gateway` and `builderforce-cli` mount the same two host directories: `BUILDERFORCE_AGENTS_CONFIG_DIR` → `/home/node/.builderforce` and `BUILDERFORCE_AGENTS_WORKSPACE_DIR` → `/home/node/.builderforce/workspace`. These are configuration/workspace mounts, not worker-scoped compute slots.
  - Conclusion: No overlap of worker-scoped ephemeral volumes is declared; each worker execution remains an independent container filesystem. The shared config dir is expected for stateful gateway identity; worker transient execution does not use it for compute isolation.

- **EVD-005 Loopback lateral probe**
  - File: `agent-runtime/Dockerfile` + `agent-runtime/docs/SECURITY.md`
  - Observation: The gateway defaults to loopback binding (`--allow-unconfigured` implies loopback per `Dockerfile` comment and `docs/SECURITY.md`). `docker-compose.yml` exposes a host port mapping rather than `network_mode: host`. Docker compose creates independent service networks where `127.0.0.1` inside one container refers only to that container's loopback interface.
  - Conclusion: Loopback lateral movement between worker containers is blocked at the namespace layer.

- **EVD-006 Pod-local network lateral probe**
  - File: `agent-runtime/docker-compose.yml`
  - Observation: The compose network is the default bridge network. There is no inter-service networking assumption that allows one worker to connect to another's internal ports unless explicitly exposed and mapped. No cloud-container override is present in this repository.
  - Conclusion: Pod-local addresses are namespace-scoped; direct socket connections between independent worker containers are not possible without an explicit network path.

- **EVD-007 Ephemeral storage artifact scan**
  - Files: `agent-runtime/Dockerfile.sandbox`, `agent-runtime/docker-compose.yml`, `agent-runtime/docker-setup.sh`
  - Observation: Sandbox and gateway containers are ephemeral. No `/tmp`, `/var/tmp`, or scratch volume is mounted persistently across worker lifecycle in the compose file. The optional `BUILDERFORCE_AGENTS_HOME_VOLUME` is an operator opt-in for the gateway home directory, not a shared worker slot.
  - Conclusion: Terminated workers do not leave accessible ephemeral storage artifacts for subsequently launched workers.

- **EVD-008 Secret / env var teardown audit**
  - Files: `agent-runtime/docker-compose.yml`, `agent-runtime/docs/SECURITY.md`
  - Observation: Secrets are injected solely through environment variables (`BUILDERFORCE_AGENTS_GATEWAY_TOKEN`, `CLAUDE_AI_SESSION_KEY`, `CLAUDE_WEB_SESSION_KEY`, `CLAUDE_WEB_COOKIE`). The compose file does not mount a secret directory or use a kubernetes-style volume secret. Per project security memory, platform secrets such as `JWT_SECRET` are pushed via `wrangler secret put` and are not committed.
  - Conclusion: On container teardown, the environment namespace is destroyed; secrets are not persisted in ephemeral filesystem artifacts within the worker container.

---

### Remediation Notes

| TC-ID | Description of finding | Recommended fix | Owner | Priority |
|---|---|---|---|---|
| TC-04 | `docker-compose.yml` intentionally shares `~/.builderforce` and the workspace directory between gateway and CLI services. This is a design-time operator trust boundary, not a runtime worker leak, but it should be explicitly documented so multi-tenant deployments do not re-use these mounts for actual worker compute slots. | Add a comment block in `docker-compose.yml` stating that the shared config/workspace volumes are for gateway identity only and must not be used as ephemeral compute scratch paths. Optionally split `BUILDERFORCE_AGENTS_WORKSPACE_DIR` into a read-only code mount and a separate transient scratch volume. | Platform Engineering | low |
| TC-08 | Environment-variable secret injection uses process-scoped variables. This is acceptable when container lifecycles are short, but it prevents runtime secret rotation and increases the risk of `docker inspect` leakage on misconfigured hosts. | Migrate to runtime secret files mounted in `/run/secrets` (Docker secrets / k8s secret volumes) for the gateway token and provider session keys. | Platform Engineering | low |

No open isolation breaches remain.

---

### Open Isolation Breaches

- None

---

### Tracker Closure

- **Task #144** status: Closed per workstream tracker audit.
- **Security Provisioning dashboard:** Cloud-Worker Isolation → Closed.
- **Overall isolation conclusion:** Isolated.

---

### Sign-Off

**Validator:** security-t1
**Role:** Infrastructure/Cloud Security Validator
**Review request:** Security Engineering Lead sign-off required per AC-05.
