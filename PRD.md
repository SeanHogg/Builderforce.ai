> **PRD** — drafted by Ada (Sr. Product Mgr) · task #565
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Egress Boundary Map with Verdicts

**Feature Name:** Egress Boundary Map

**Status:** Draft

---

## 1. Problem & Goal

**Problem:** Security and network teams struggle to visualize and audit the organization’s egress posture. Existing tools focus on ingress traffic or provide only rule-level views, leaving blind spots on which internal assets can reach which external destinations and through which allowed paths. This leads to overly permissive egress, missed exposures, and slow compliance audits.

**Goal:** Provide a dynamic, interactive boundary map that clearly displays all possible egress vectors (source asset → destination IP/FQDN / port / protocol) and attaches an allow/deny verdict based on the aggregation of all relevant security policies. The map empowers teams to instantly identify unintended exposures, verify policy intent, and accelerate audit preparation.

---

## 2. Target Users / ICP Roles

- **Cloud Security Architect:** Needs a holistic view of egress risk to validate segmentation designs and identify over‑privileged paths.
- **Network Security Engineer:** Wants to troubleshoot connectivity issues and verify that firewall/NAT/proxy rules match the intended egress boundaries.
- **Compliance & Risk Analyst:** Requires easy exportable evidence of egress controls for audits (PCI, SOC2, ISO 27001) without manual rule tracing.
- **Incident Responder:** Needs fast lookup of which assets can egress to a suspect external IP or domain.

---

## 3. Scope

- **In scope:**
  - Egress vectors only (traffic originating from internal/cloud assets toward external/untrusted networks).
  - Policy sources: cloud security groups (AWS, Azure, GCP), on‑prem firewalls, proxy servers, NACLs, and network security groups.
  - Verdict resolution (allow/deny) considering rule priority, overlap, and default actions.
  - Visual boundary map with interactive filtering and drill‑down.
  - Tabular list view of all vectors with export capability.
  - Incremental updates when policy changes are detected.

---

## 4. Functional Requirements

### 4.1 Data Ingestion
- Support read‑only integration (API, file import, agent) with:
  - AWS Security Groups (VPC, EC2) and Network ACLs
  - Azure NSGs and Azure Firewall
  - GCP VPC Firewall rules
  - On‑prem firewall configurations (Palo Alto, Cisco ASA/FTD, Fortinet) via exported config
  - Proxy/PAC file rules (Zscaler, Netskope, Squid)
- Parse and normalize rule structures into a common schema (source [cidr/tag/asset], destination [fqdn/ip/range], port/protocol, action, priority).

### 4.2 Vector Mapping
- Generate all potential egress vectors as tuples: (Source Asset, Destination Endpoint, Port, Protocol).
- Resolve network objects (tags, dynamic groups) to concrete IP/FQDN lists at runtime.
- Apply all policies in order of precedence to derive a final allow/deny verdict per vector.
- Handle overlapping rules: most specific wins (or admin‑defined conflict resolution).
- Flag vectors with conflicting policies (e.g., one rule allows, another later denies due to priority).

### 4.3 Visualization
- Interactive graph view:
  - Source assets (left) connected to destination tiles (right) via edges.
  - Edge color: green (allow), red (deny), gray (no explicit rule → implicit deny or default).
  - Hover/click reveals rule IDs, last updated, justification (if available).
- Filtering by:
  - Source asset name/tag/IP range
  - Destination domain/IP/geolocation
  - Port/service
  - Verdict (allow/deny/conflict)
  - Policy set (e.g., only AWS VPC rules)
- Search capability for a specific destination or asset.
- Toggle between map and a raw vector list (with sorting, grouping).

### 4.4 Export & Sharing
- Export the visible map (SVG/PNG) or full vector table (CSV, JSON, PDF) for audits.
- One‑click “share” with permalink that replays the current view (including filters) for colleagues.

### 4.5 Freshness & Performance
- Policy change detection: react within 15 minutes to updates from connected sources.
- Map rendering: display up to 10,000 distinct egress vectors within 10 seconds.
- Support environments with up to 50,000 total policy rules (across all sources).

---

## 5. Acceptance Criteria

1. **Correctness:** In a controlled test environment with a known set of firewall rules, the map correctly labels at least 95% of test vectors as allow/deny when compared to a manual packet‑forwarding simulation.
2. **Conflict handling:** Conflicting rules are flagged with a warning badge; user can drill into the conflicting rules.
3. **Default behavior:** For any destination not explicitly mentioned in any rule, the verdict is “deny (implicit)” with a note referencing the default policy.
4. **Update latency:** After a security group rule is added/changed in AWS, the corresponding vector verdict updates within 15 minutes and triggers a timeline entry.
5. **Scalability:** The UI successfully renders a map containing 10,000 vectors without browser freezing, and an interactive filter reduces the visible set in under 2 seconds.
6. **Export integrity:** A CSV export contains all displayed columns (source, destination, port, protocol, verdict, supporting rule IDs) and matches the on‑screen data exactly.
7. **Multi‑source synthesis:** A vector that traverses an on‑prem firewall *and* a cloud security group shows the aggregated verdict (e.g., both must allow; if either denies, final is deny). Test with a hybrid setup.
8. **Audit readiness:** A generated PDF includes a timestamp, source list, and a disclaimer about rule freshness; its content passes a mock PCI DSS auditor review of egress documentation.

---

## 6. Out of Scope

- Ingress (inbound) traffic mapping and verdicts.
- Real‑time traffic flow monitoring or packet‑level verification (the map shows policy intent, not actual live traffic).
- Automatic rule remediation or firewall configuration changes.
- Machine‑learning‑based rule optimization suggestions.
- Full network topology discovery (only assets relevant to egress paths).
- User authentication/authorization (delegated to the platform’s existing RBAC).
- Historical diff views between policy versions (snapshot only, though latest state).

## Requirements

> **Authored by:** Business Analyst · task #565 · 2026-07-27

### 7. User Stories (Epics)

#### EPIC-A — Policy Ingestion & Normalization
- **US-A1:** As a **Cloud Security Architect**, I want to connect my cloud accounts (AWS, Azure, GCP) via read-only API so that the boundary map automatically discovers and ingests all security groups, NSGs, and firewall rules without manual export.
- **US-A2:** As a **Network Security Engineer**, I want to upload an exported on-prem firewall configuration (Palo Alto, Cisco ASA/FTD, Fortinet) so that hybrid-cloud egress vectors are modeled in a single unified map.
- **US-A3:** As a **Network Security Engineer**, I want to import proxy/PAC file rules (Zscaler, Netskope, Squid) so that proxy-enforced egress paths are reflected in the verdict engine.
- **US-A4:** As a **Cloud Security Architect**, I want all ingested rules normalized into a common schema (source, destination, port, protocol, action, priority) so that cross-vendor rule comparison and aggregation is possible.

#### EPIC-B — Vector Mapping & Verdict Resolution
- **US-B1:** As a **Cloud Security Architect**, I want the system to automatically enumerate all possible egress vectors as `(source, destination, port, protocol)` tuples so that I see a complete picture of potential egress, not just rules in isolation.
- **US-B2:** As a **Network Security Engineer**, I want overlapping rules to be resolved deterministically (most specific wins, with a documented conflict-resolution algorithm) so that the verdict I see is the one the network would actually enforce.
- **US-B3:** As a **Compliance & Risk Analyst**, I want every vector that lacks an explicit rule to display the verdict "deny (implicit)" with a reference to the default policy so that audit evidence clearly distinguishes explicit vs. default denials.
- **US-B4:** As a **Cloud Security Architect**, I want vectors with conflicting policies (one rule allows, another denies) flagged with a warning badge and drill-down so that I can remediate unintended exposures immediately.
- **US-B5:** As a **Network Security Engineer**, I want dynamic network objects (tags, security group references, address groups) resolved to concrete IP/FQDN lists at runtime so that the map reflects the current network reality, not stale placeholders.

#### EPIC-C — Visualization & Interaction
- **US-C1:** As a **Cloud Security Architect**, I want an interactive graph where source assets on the left connect to destination tiles on the right via color-coded edges (green=allow, red=deny, gray=implicit deny) so that I can visually scan the egress posture in seconds.
- **US-C2:** As a **Network Security Engineer**, I want to hover/click any edge to reveal the rule IDs, last-updated timestamp, and justification so that I can trace a verdict back to its source policy without leaving the map.
- **US-C3:** As a **Compliance & Risk Analyst**, I want to filter the map by source asset, destination, port/service, verdict, and policy set so that I can narrow a 10,000-vector landscape to the exact subset relevant to my audit scope.
- **US-C4:** As an **Incident Responder**, I want a search bar that accepts a destination IP or domain and instantly highlights all egress paths to it so that I can triage whether a suspect external address is reachable from our assets.
- **US-C5:** As a **Cloud Security Architect**, I want to toggle between the graph view and a sortable, groupable tabular list of all vectors so that I can choose the representation best suited to my current task.

#### EPIC-D — Export, Sharing & Audit Readiness
- **US-D1:** As a **Compliance & Risk Analyst**, I want to export the visible vector table as CSV/JSON containing all displayed columns (source, destination, port, protocol, verdict, supporting rule IDs) so that I can include policy evidence in audit submissions.
- **US-D2:** As a **Compliance & Risk Analyst**, I want to export the map as SVG/PNG for inclusion in reports and presentations.
- **US-D3:** As a **Compliance & Risk Analyst**, I want a one-click PDF export that includes a timestamp, the source list, a rule-freshness disclaimer, and the full vector table so that the output passes a PCI DSS auditor review of egress documentation.
- **US-D4:** As a **Cloud Security Architect**, I want a one-click "share" action that generates a permalink replaying my current view (including all active filters) so that colleagues see exactly what I see without re-applying filters.

#### EPIC-E — Freshness, Performance & Notification
- **US-E1:** As a **Cloud Security Architect**, I want the system to detect policy changes from connected sources and update affected vector verdicts within 15 minutes so that the map never represents a stale security posture.
- **US-E2:** As a **Network Security Engineer**, I want a timeline/changelog entry for every policy change detected so that I can correlate verdict changes with the rule modification that caused them.
- **US-E3:** As a **Cloud Security Architect**, I want the map to render up to 10,000 vectors without browser freezing and to support filtering that reduces the visible set in under 2 seconds so that the tool remains usable at enterprise scale.
- **US-E4:** As a **Network Security Engineer**, I want the system to support environments with up to 50,000 total policy rules across all connected sources so that large hybrid enterprises are fully covered.

---

### 8. System Requirements

#### SR1 — Data Architecture
- **SR1.1 Common Schema:** The ingestion pipeline MUST normalize every imported rule into a unified structure: `(source: string, destination: string, port: number | range, protocol: tcp | udp | icmp | any, action: allow | deny, priority: number, origin: { provider, resourceId, lastModified })`. Port/protocol fields support ranges and wildcards.
- **SR1.2 Asset Resolution:** Network objects (AWS security group references, Azure NSG tags, GCP network tags, dynamic address groups) MUST be resolved to concrete CIDR/IP/FQDN lists at vector-generation time, not at ingestion time. The resolution is invalidated and recomputed when the underlying object changes.
- **SR1.3 Verdict Engine:** The verdict resolver MUST apply rules in priority order (lowest number = highest priority) per policy source, with deterministic tie-breaking: (a) explicit deny beats explicit allow at equal specificity, (b) most specific CIDR/port match wins, (c) when specificity is equal, highest priority wins, (d) a later-added rule at equal priority and specificity replaces the earlier one. The engine MUST emit the final verdict (`allow` | `deny (explicit)` | `deny (implicit)` | `conflict`) and the list of rule IDs that contributed.
- **SR1.4 Multi-Source Aggregation:** For a vector that spans multiple policy sources (e.g., on-prem firewall + cloud security group), the aggregated verdict MUST be computed as: final = ALLOW only if ALL contributing sources allow; final = DENY if ANY source explicitly denies; when a source has no matching rule, that source contributes an implicit deny. The aggregated verdict MUST record which sources contributed and their individual verdicts.

#### SR2 — Performance & Scalability
- **SR2.1 Vector Enumeration:** The vector generator MUST produce the full cross-product of resolved sources × destinations × ports × protocols for up to 10,000 vectors. Beyond 10,000, the system MUST support lazy enumeration and filtering so the user controls scope.
- **SR2.2 Render Budget:** The interactive graph MUST initialize within 10 seconds for 10,000 vectors. Filtering MUST reduce the visible set to ≤2 seconds. The browser MUST NOT freeze; rendering MUST yield to the main thread.
- **SR2.3 Rule Scale:** The ingestion and verdict pipelines MUST support up to 50,000 total rules across all connected policy sources. Rule ingestion is idempotent — re-ingesting an unchanged rule MUST NOT duplicate it.
- **SR2.4 Update Latency:** After a policy change is detected from a connected source, the corresponding vector verdicts MUST be recomputed and surfaced within 15 minutes. A timeline/changelog entry MUST be created recording the detected change.

#### SR3 — Data Integrity
- **SR3.1 Audit Trail:** Every verdict change (initial computation or re-computation after a policy update) MUST record a timestamp, the previous verdict, the new verdict, and the rule set that produced the change, forming an immutable audit log.
- **SR3.2 Export Fidelity:** A CSV/JSON export MUST contain every column displayed on-screen (source, destination, port, protocol, verdict, supporting rule IDs) and MUST match the on-screen data row-for-row at the time of export. The export MUST include a generation timestamp and the filter state used.
- **SR3.3 PDF Audit Package:** The PDF export MUST include: (a) generation timestamp, (b) list of connected policy sources with last-sync timestamps, (c) a freshness disclaimer, (d) the complete filtered vector table, (e) a summary of verdict counts (allow / deny-explicit / deny-implicit / conflict).

#### SR4 — Integration Interfaces
- **SR4.1 Cloud Providers:** Read-only integration via official provider APIs using cross-account IAM roles (AWS), service principals with Reader role (Azure), or service accounts with `compute.networkViewer` role (GCP). Credentials MUST be stored encrypted; the system MUST NOT require write permissions.
- **SR4.2 On-Prem Firewalls:** Configuration import via file upload (XML/YAML/JSON depending on vendor export format). The system MUST validate the format before ingestion and reject malformed files with a descriptive error.
- **SR4.3 Proxy Rules:** PAC file and vendor proxy rule import via file upload. The system MUST parse PAC `FindProxyForURL()` logic into per-destination verdicts; where dynamic logic cannot be resolved statically, the entry MUST be flagged as "conditional" with the PAC logic shown.

#### SR5 — Conflict Handling
- **SR5.1 Conflict Detection:** A vector is in CONFLICT when two or more rules at the same specificity and priority produce opposite actions. The conflict MUST be surfaced as a warning badge on the vector.
- **SR5.2 Conflict Resolution Override:** The admin MUST be able to specify a conflict-resolution preference: "most restrictive wins" (default), "least restrictive wins", or "flag only — manual resolution required." The override applies per policy source or globally.
- **SR5.3 Conflict Drill-Down:** Clicking a conflict badge MUST display the conflicting rules side-by-side with rule IDs, priorities, and last-modified timestamps.

---

### 9. Traceability Matrix

| Requirement | AC # | Description |
|---|---|---|
| US-B2, SR1.3 | AC1 | Correct verdict resolution at ≥95% accuracy vs. manual simulation |
| US-B4, SR5.1–SR5.3 | AC2 | Conflict flagging + drill-down |
| US-B3, SR1.3 | AC3 | Implicit deny for unmatched vectors |
| US-E1, SR2.4 | AC4 | 15-minute update latency + timeline entry |
| US-C2, US-C3, SR2.2 | AC5 | 10,000-vector render + sub-2s filter |
| US-D1, SR3.2 | AC6 | CSV export fidelity |
| US-B5, SR1.4 | AC7 | Multi-source synthesis (hybrid on-prem + cloud) |
| US-D3, SR3.3 | AC8 | PDF audit readiness (PCI DSS mock review) |
| US-A1–US-A4, SR4.1–SR4.3 | — | All policy sources ingestible and normalized |
| US-C4 | — | Search by destination IP/domain |
| US-D4 | — | Permalink with current filter state |
| US-E4, SR2.3 | — | 50,000-rule scale |

---

### 10. Non-Functional Requirements

- **NFR1 — Read-Only:** All integrations with cloud and on-prem policy sources MUST be read-only. The system MUST NOT modify, create, or delete firewall rules, security groups, or proxy configurations under any circumstance.
- **NFR2 — RBAC Delegation:** The boundary map MUST respect the platform's existing RBAC for access control. Authorization checks (who can view/edit/export the map) are delegated to the platform's identity layer — the map surface is per-tenant/segment and MUST NOT implement its own authentication.
- **NFR3 — Encryption at Rest:** Imported rule data and resolved vectors MUST be stored encrypted at rest. Integration credentials (IAM role ARNs, service principal secrets) MUST be stored in the platform vault, never in plaintext.
- **NFR4 — Audit Logging:** Every CRUD operation on policy sources, every verdict recomputation batch, every export, and every share action MUST produce an immutable audit log entry with actor, timestamp, and payload hash.
- **NFR5 — Graceful Degradation:** If a connected policy source is unreachable, the map MUST display the last-known state for that source with a clear "stale since <timestamp>" banner and a warning icon; other sources continue to render normally.
- **NFR6 — No Live Traffic:** The map shows policy intent, not actual traffic flow. The UI MUST include a visible disclaimer: "Verdicts represent policy evaluation, not live traffic."

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._

## Acceptance

_Owned by the validator — to be authored._