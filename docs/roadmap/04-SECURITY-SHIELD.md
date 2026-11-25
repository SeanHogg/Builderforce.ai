# SEC — Security Shield

**Priority: P0.** Secure code and runtime execution. Every WebContainer and agent environment runs a mandatory Security Shield in its trusted runtime layer, integrated with enforcement outside the guest where the host offers stronger isolation.

Part of the [strategic roadmap](../../ROADMAP.md). Entry fields are defined in [00-STRATEGY.md](./00-STRATEGY.md#entry-format).


## Layers

| Layer | Responsibility |
|---|---|
| Admission | Validate manifest, dependencies and execution permissions |
| Identity | Runtime-minted identities and scoped credentials |
| Code scanning | Malware, malicious scripts, suspicious code |
| Dependency scanning | CVEs, malicious packages, supply-chain risk |
| Network ingress | Authenticate and authorize incoming traffic |
| Network egress | Destination allowlists and declared external APIs |
| Runtime behavior | Tool calls, processes, resource consumption |
| Data protection | VFS isolation, secret redaction, tenant boundaries |
| Agent security | Prompt injection, privilege escalation, tool misuse |
| Response | Block, quarantine, suspend or terminate |
| Governance | Immutable or tamper-evident audit evidence |
| Recovery | Restore verified state and revoke compromised credentials |

## Open-source integrations

YARA / YARA-X, ClamAV, Semgrep, CodeQL, OSV-Scanner, Trivy, Gitleaks, Syft, Sigstore / Cosign, Open Policy Agent; OWASP ASVS and agentic-AI guidance, NIST SSDF, SLSA.

Native scanners need a WASM port or an external trusted scanning service. None is advertised as browser-native until that execution path is verified.


## Entries

### SEC-01 — Complete PRD 31 W10

```yaml roadmap
id: SEC-01
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: Complete PRD 31 W10.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-02 — Correct application identity and origin isolation

```yaml roadmap
id: SEC-02
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies:
  - SEC-01
objective: Correct application identity and origin isolation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-03 — Mandatory ingress and egress enforcement

```yaml roadmap
id: SEC-03
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies:
  - SEC-01
objective: Mandatory ingress and egress enforcement.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-04 — Manifest-declared external APIs

```yaml roadmap
id: SEC-04
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies:
  - WC-02
  - SEC-03
objective: Manifest-declared external APIs.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-05 — Malware signature engine

```yaml roadmap
id: SEC-05
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: Malware signature engine.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-06 — Static and dependency scanning

```yaml roadmap
id: SEC-06
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: Static and dependency scanning.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-07 — Prompt injection defenses

```yaml roadmap
id: SEC-07
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: Prompt injection defenses.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-08 — Agent permission enforcement

```yaml roadmap
id: SEC-08
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies:
  - AVR-06
objective: Agent permission enforcement.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-09 — Tenant and workspace isolation

```yaml roadmap
id: SEC-09
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: Tenant and workspace isolation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-10 — Automated incident response

```yaml roadmap
id: SEC-10
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies:
  - SEC-05
objective: Automated incident response.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-11 — Runtime behavioral monitoring

```yaml roadmap
id: SEC-11
program: security-shield
priority: P1
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: Runtime behavioral monitoring.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-12 — Artifact signing and provenance

```yaml roadmap
id: SEC-12
program: security-shield
priority: P1
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: Artifact signing and provenance.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-13 — Adversarial and scale testing

```yaml roadmap
id: SEC-13
program: security-shield
priority: P0
status: planned
arc: run
source: PRD-31-W10
dependencies:
  - SEC-03
objective: Adversarial and scale testing.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-14 — Governance auditor integration

```yaml roadmap
id: SEC-14
program: security-shield
priority: P1
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: Governance auditor integration.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### SEC-15 — SIEM and SOC 2 evidence integration

```yaml roadmap
id: SEC-15
program: security-shield
priority: P1
status: planned
arc: run
source: PRD-31-W10
dependencies: []
objective: SIEM and SOC 2 evidence integration.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```
