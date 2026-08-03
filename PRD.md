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

_Owned by the business-analyst — to be authored._

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