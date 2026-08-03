> **PRD** — drafted by Ada (Sr. Product Mgr) · task #564
> _Each agent that updates this PRD signs its change below._
> - **BA-001** — 2026-08-03: Business Analyst (task #564) — Authored Requirements section (REQ-001 through REQ-028)

# Product Requirements Document: Sandbox Egress Validation

## Problem & Goal
**Problem:** Sandbox environments (VPCs, subnets, accounts) often retain unintended outbound network paths due to misconfigured route tables, security groups, or peering connections. These unauthorized egress points enable data exfiltration, C2 communication, and violate compliance mandates. Manual audits cannot scale and miss transient misconfigurations.

**Goal:** Provide an automated, continuous validation service that detects any outbound network path from a defined sandbox boundary that is not explicitly authorized, reducing the risk of unauthorized data flows.

## Target users / ICP roles
- Cloud Security Engineers responsible for maintaining network isolation
- Compliance Officers who must prove egress restrictions for audits
- DevOps/Platform Engineers managing sandbox lifecycle for development, testing, or untrusted workloads

**ICP:** Enterprises using cloud sandboxes that require strict network segmentation (e.g., financial services, healthcare, security research).

## Scope
**In scope**  
- Define sandbox boundaries via VPCs, subnets, security groups, or account-level groupings.  
- Validate all cloud constructs that dictate outbound traffic: route tables (IGW, NAT, VPG, peering, transit gateway), security group outbound rules, network ACLs, egress-only internet gateways, VPC endpoints, and PrivateLink services.  
- Compare discovered egress paths against a customer-defined allowlist of authorized destinations (CIDR, port, protocol).  
- Detect and report violations as configuration drifts away from the allowlist.  
- Deliver findings through a dashboard, alerts (SNS, Slack, etc.), and APIs.  

**Out of scope**  
- Inbound path validation.  
- Host-based firewalls, OS-level configurations, or application-level egress.  
- Dynamic inspection of live network flows (this is configuration validation only).  
- Automatic remediation or blocking of egress paths.  
- Creation or modification of network policies.

## Functional requirements
1. **Boundary Definition** – Users can declare a sandbox boundary through tagging or selecting resources (VPCs, subnets, accounts). The system must aggregate all networking components associated with that boundary.
2. **Authorized Egress Policy** – Users define an allowlist of outbound destinations as CIDR blocks, port ranges, protocols, or service endpoints (e.g., “*.s3.amazonaws.com”). The policy can be applied to one or more boundaries.
3. **Path Discovery** – The system must enumerate all potential egress routes within the defined boundary:
   - Every route table entry (destination CIDR, target: IGW, NAT gateway/instance, VPC peering, transit gateway, virtual private gateway, egress-only internet gateway, local).
   - Security group outbound rules (considering stateful allow-all return traffic, but the focus is egress initiation).
   - Network ACL outbound rules.
   - VPC endpoints and PrivateLink connections that can reach external services.
   - Peering and transit gateway routes that extend connectivity to other networks.
4. **Violation Detection** – For each path, compare the effective allowed destinations against the authorized policy. A violation is flagged when:
   - A route enables traffic to a CIDR or service not present in the allowlist.
   - A security group or NACL permits outbound traffic to unauthorized destinations.
   - An egress point (IGW, NAT, etc.) is attached without a matching policy override.
   - Overly permissive rules (0.0.0.0/0) are considered critical violations unless explicitly authorized.
5. **Reporting & Alerting** – Produce a list of violations with severity, resource ID, rule details, and recommended action. Integrate with SIEM, ticketing systems, and real-time notification channels. Provide a dashboard showing current compliance posture and history.
6. **Scan Frequency** – Support on-demand scans and recurring schedules (minimum every hour). Optionally, trigger scans in response to CloudTrail/API configuration changes (near real-time, within 5 minutes of an event).
7. **Multi-Cloud Initial Target** – AWS first; architecture must support Azure and GCP network constructs in subsequent releases.
8. **Programmatic Access** – REST API and CLI to create boundaries, define policies, trigger scans, and retrieve violation reports.

## Acceptance criteria
- **AC1:** A sandbox VPC with a route to an internet gateway and no corresponding “allow internet” policy generates a critical violation within the next scheduled or event-driven scan.
- **AC2:** A sandbox boundary with only outbound security group rules allowing 10.0.0.0/8 and route table entries pointing to a VPC endpoint for an approved service produces zero violations.
- **AC3:** Modifying a route table to add a 0.0.0.0/0 route via a NAT gateway, where the policy only allows access to 192.168.0.0/16, triggers an alert in under 5 minutes when event-driven scanning is enabled.
- **AC4:** The system scans 500 boundaries with an average of 20 routing/nacls/sg entries each in under 2 minutes using parallel evaluation.
- **AC5:** The API returns all current violations for a requested boundary within 2 seconds for paused (cached) results and under 30 seconds when triggering a fresh scan.

## Out of scope
- Inline blocking or enforcement of network traffic.
- Live traffic analysis (packet inspection or flow logs).
- Definition or creation of network policies; the service is read-only.
- Validation of inbound paths.
- Configuration of 3rd-party security appliances, host firewalls, or container network plugins.
- On-premises/non-cloud environments (initial release).

## Requirements

_Owned by the business-analyst — authored by BA (task #564, 2026-08-03)._

Each requirement is traceable to one or more functional requirements (FR) and acceptance criteria (AC) in the preceding sections. Priority is derived from impact on the detection surface and operational severity: **P0** = the feature cannot function without it; **P1** = required for MVP launch; **P2** = important for operational maturity within the first quarter; **P3** = nice-to-have scheduled after launch.

### REQ-001 — Boundary Resource Model
**Priority:** P0 | **Traces to:** FR1 | **Verified by:** AC1, AC2, AC4

The system shall model a sandbox boundary as an ordered collection of one or more cloud resources (VPC, subnet, security group, or AWS account ID) identified by a user-assigned tag key/value pair or explicit ARN list. Each boundary shall have a unique user-defined name, an optional description, and a creation timestamp. Resources within a boundary are discovered at scan time via the cloud provider's resource API; membership shall be re-evaluated on every scan to detect additions and removals.

- **REQ-001a:** The system shall support bounding by VPC ID, subnet ID, security group ID, or AWS account ID — individually or in combination — so users can scope a boundary to a single VPC, a set of subnets across VPCs, or an entire account.
- **REQ-001b:** The system shall support tag-based boundary membership: a user provides `tag_key` and `tag_value`, and the system expands that to the set of matching resources (VPCs, subnets) at scan time.

### REQ-002 — Boundary API
**Priority:** P1 | **Traces to:** FR1, FR8 | **Verified by:** AC4, AC5

The system shall expose a REST API to create, read, update, delete, and list sandbox boundary definitions. Each boundary shall be an independent resource with a stable UUID.

- **REQ-002a:** `POST /boundaries` accepts `name`, `description`, `resource_type` (one of `vpc`, `subnet`, `security_group`, `account`, `tag`), and `resource_ids` (array of ARNs) or `tag_filter` (`{key, value}`). Returns the created boundary with its UUID.
- **REQ-002b:** `GET /boundaries` returns a paginated list of all boundaries with their current compliance summary (violation count by severity).
- **REQ-002c:** `GET /boundaries/{id}` returns the full boundary definition plus the most recent scan timestamp and violation aggregate.
- **REQ-002d:** `PUT /boundaries/{id}` updates mutable fields (`name`, `description`, `resource_ids`, `tag_filter`). Changing resource membership shall invalidate any cached scan result for that boundary so the next scan re-evaluates the full surface.
- **REQ-002e:** `DELETE /boundaries/{id}` soft-deletes the boundary and removes its policy associations and cached scan results.

### REQ-003 — Authorized Egress Policy Model
**Priority:** P0 | **Traces to:** FR2 | **Verified by:** AC1, AC2, AC3

The system shall model an authorized egress policy as a named, versioned allowlist of outbound destinations. A destination is defined as a tuple of `(cidr, port_range, protocol, service_endpoint)` where at minimum one of `cidr` or `service_endpoint` is populated. A policy can be associated with one or more boundaries; a boundary without an associated policy shall be treated as having zero authorized destinations — every egress path found will be a violation.

- **REQ-003a:** `port_range` may be a single port (`443`), a range (`8000-9000`), or `*` (all ports). `protocol` may be `tcp`, `udp`, `icmp`, or `*`. `service_endpoint` may be an AWS service name (e.g., `com.amazonaws.us-east-1.s3`) or a PrivateLink service name.
- **REQ-003b:** A policy entry with `cidr: 0.0.0.0/0` and `port_range: *` and `protocol: *` explicitly authorizes full internet egress from the associated boundary. Without this entry, any 0.0.0.0/0 route found will be flagged as a critical violation.
- **REQ-003c:** Policies shall be versioned: every mutation creates a new immutable version. Scans always reference the version current at scan start time, so reports are reproducible.

### REQ-004 — Policy API
**Priority:** P1 | **Traces to:** FR2, FR8 | **Verified by:** AC5

The system shall expose a REST API to create, read, update, delete, and list authorized egress policies.

- **REQ-004a:** `POST /policies` accepts `name`, `description`, and `entries[]` where each entry is `{cidr, port_range, protocol, service_endpoint}`. Returns the policy with its UUID and version number.
- **REQ-004b:** `GET /policies` returns a paginated list with the count of associated boundaries.
- **REQ-004c:** `GET /policies/{id}` returns the policy with its current entries and version history summary.
- **REQ-004d:** `PUT /policies/{id}` accepts a new `entries[]` list; this creates a new version. Boundaries associated with the policy shall use the new version on their next scan.
- **REQ-004e:** `POST /policies/{id}/associate` and `POST /policies/{id}/dissociate` accept a `boundary_id` to link or unlink a boundary to this policy. A boundary may be associated with exactly one policy at a time; associating to a second policy replaces the first.

### REQ-005 — AWS Route Table Discovery
**Priority:** P0 | **Traces to:** FR3, FR7 | **Verified by:** AC1, AC3, AC4

The system shall enumerate all route table entries for every VPC within a boundary. For each route entry, it shall capture: the route table ID, the destination CIDR block, the target type (IGW, NAT gateway, NAT instance, VPC peering connection, transit gateway, virtual private gateway, egress-only internet gateway, VPC endpoint, local), and the target resource ID.

- **REQ-005a:** The system shall classify each route target into one of the following egress categories: `internet` (IGW target), `nat` (NAT gateway/instance target), `peered_vpc` (VPC peering target), `transit_gateway` (TGW target), `vpn` (VPG target), `egress_only_ipv6` (EIGW target), `vpc_endpoint` (VPCE target), or `local` (VPC-local traffic, no egress concern).
- **REQ-005b:** `local` routes shall be excluded from violation analysis for all protocols. Traffic confined to the VPC is not egress.
- **REQ-005c:** The system shall use the AWS `DescribeRouteTables` API and shall paginate through all results. It shall be capable of discovering at least 10 000 route table entries in a single boundary scan without truncation.

### REQ-006 — AWS Security Group Outbound Rule Discovery
**Priority:** P0 | **Traces to:** FR3, FR7 | **Verified by:** AC2, AC4

The system shall enumerate all outbound security group rules for every security group attached to an ENI within a boundary's VPCs. For each rule, it shall capture: the security group ID, the destination CIDR or referenced security group ID, the IP protocol, the port range, and an optional description.

- **REQ-006a:** Rules that reference another security group as the destination shall be expanded at scan time to the set of CIDRs of the ENIs in the referenced group. If the referenced group is empty or unresolvable, the rule shall be treated as permitting traffic to an unknown destination — classified as a violation unless the policy contains an explicit wildcard exemption for security-group-referenced rules.
- **REQ-006b:** Rules with `-1` (all protocols) shall be matched against every protocol entry in the allowlist. If no entry in the policy covers all protocols for that destination, the rule is a violation.

### REQ-007 — AWS Network ACL Outbound Rule Discovery
**Priority:** P0 | **Traces to:** FR3, FR7 | **Verified by:** AC4

The system shall enumerate all outbound NACL entries for every NACL associated with subnets in the boundary. NACL rules are stateless, so both the ephemeral-port return-path issue is irrelevant for egress — outbound rules represent egress in full. Each outbound NACL entry with action `allow` shall be treated as a potential egress path.

- **REQ-007a:** NACL rules are evaluated in rule-number order within each subnet association. The system shall compute the effective allow set per subnet by applying the first-matching-rule logic and shall use this effective set for policy comparison.

### REQ-008 — VPC Endpoint and PrivateLink Discovery
**Priority:** P1 | **Traces to:** FR3 | **Verified by:** AC2

The system shall enumerate all VPC endpoints (gateway and interface) and PrivateLink connections within the boundary's VPCs. Each endpoint shall be captured with its service name, type (Gateway / Interface), and the route tables (Gateway endpoints) or subnets (Interface endpoints) it serves.

- **REQ-008a:** A Gateway VPC endpoint for an AWS service (e.g., S3, DynamoDB) represents a path to that service. The system shall treat the endpoint's service name as a `service_endpoint` destination for comparison against the allowlist.
- **REQ-008b:** An Interface VPC endpoint or PrivateLink connection to an external service (not an AWS service) shall be treated as a path to the PrivateLink service name. If the service name is not present in the allowlist, it is a violation.

### REQ-009 — VPC Peering and Transit Gateway Egress Discovery
**Priority:** P1 | **Traces to:** FR3 | **Verified by:** AC4

For every VPC peering connection and transit gateway attachment within the boundary, the system shall recursively inspect the peered/acceptor VPC's route tables to determine whether traffic can egress beyond the peered network. The recursion depth shall be configurable (default: 2 hops).

- **REQ-009a:** If the peered/acceptor VPC is itself within the same boundary, its routes are already covered and shall not be re-evaluated (cycle prevention).
- **REQ-009b:** If the peered/acceptor VPC is outside the boundary, its outbound paths represent egress from the sandbox and shall be evaluated against the boundary's policy. If the peered VPC's route tables cannot be read (cross-account without authorization), the peering connection itself shall be flagged as a violation with severity `high` and a recommended action: "Grant read access or remove the peering connection."

### REQ-010 — Violation Detection Engine
**Priority:** P0 | **Traces to:** FR4 | **Verified by:** AC1, AC2, AC3

The system shall compare every discovered egress path against the boundary's associated authorized egress policy. A violation record shall be generated for any path whose `(cidr, port_range, protocol, service_endpoint)` combination is not covered by at least one entry in the allowlist.

- **REQ-010a:** CIDR matching shall follow the longest-prefix-match rule: a route to `10.0.1.0/24` is covered by a policy entry of `10.0.0.0/8` but a route to `0.0.0.0/0` is not covered by `10.0.0.0/8`.
- **REQ-010b:** Port matching: a policy entry with port `443` covers a rule with port `443` but not `8443`. A policy entry with port `*` covers all ports. A policy entry with port range `8000-9000` covers a rule with port `8080`.
- **REQ-010c:** Protocol matching: `tcp` in policy covers `tcp` rules but not `udp` or `icmp`. `*` in policy covers all protocols.
- **REQ-010d:** The `0.0.0.0/0` default route, when found with an internet-facing target (IGW, NAT gateway, NAT instance), shall be classified as a **critical** severity violation unless the policy contains an explicit `cidr: 0.0.0.0/0` entry. This special rule prevents accidental blanket-internet authorization.
- **REQ-010e:** An egress-only internet gateway route (`::/0`) shall be matched against the IPv6-equivalent of the allowlist (CIDR entries with IPv6 prefixes). An `::/0` route without an explicit `::/0` policy entry is a critical violation.

### REQ-011 — Violation Severity Classification
**Priority:** P1 | **Traces to:** FR4, FR5 | **Verified by:** AC1, AC3

Every violation shall be assigned a severity according to the following rules:

| Severity | Condition |
|----------|-----------|
| **critical** | `0.0.0.0/0` or `::/0` route via internet-facing target without explicit policy authorization |
| **critical** | IGW, NAT gateway, or EIGW attached to a VPC in the boundary without any policy entry that covers the internet target |
| **high** | Route to a non-RFC 1918 CIDR (public IP space) via any non-local target that is not covered by the policy |
| **high** | Security group rule or NACL rule allowing outbound to `0.0.0.0/0` or `::/0` on a sensitive port (22, 3389, 1433, 3306, 5432, 6379, 27017) without policy authorization |
| **high** | Unauthorized VPC peering or TGW route that exits the boundary to an unreadable external VPC |
| **medium** | Security group or NACL rule allowing outbound to a non-RFC 1918 CIDR not in the policy |
| **medium** | VPC endpoint or PrivateLink to a service not in the allowlist |
| **low** | Route or rule permitting outbound to an RFC 1918 private CIDR that is outside the boundary and not covered by the policy |
| **info** | Policy covers the path but the rule is overly broad relative to the policy entry (e.g., policy says `10.0.0.0/16` port `443` but rule allows `10.0.0.0/8` port `*`) |

### REQ-012 — Violation Record Structure
**Priority:** P1 | **Traces to:** FR5 | **Verified by:** AC5

Each violation record shall contain the following fields:

- `violation_id`: UUID, stable across scans for the same (resource, rule, destination) tuple.
- `boundary_id`: UUID of the boundary in which the violation was found.
- `scan_id`: UUID of the scan that produced this finding.
- `severity`: One of `critical`, `high`, `medium`, `low`, `info`.
- `resource_type`: `route_table`, `security_group`, `network_acl`, `vpc_endpoint`, `vpc_peering`, `transit_gateway`.
- `resource_id`: The cloud resource ARN or ID.
- `rule_detail`: Human-readable description of the offending rule (e.g., "Route 0.0.0.0/0 → igw-0a1b2c3d4e5f67890").
- `destination`: The CIDR, port, and protocol permitted by the rule.
- `violated_policy_id`: UUID of the policy the boundary was checked against.
- `recommended_action`: A human-readable remediation suggestion (e.g., "Add 0.0.0.0/0 to the authorized egress policy, or remove the IGW route").
- `first_seen`: Timestamp of the scan that first detected this violation.
- `last_seen`: Timestamp of the most recent scan where the violation was still present.
- `resolved_at`: Timestamp when the violation was last confirmed absent (null if still open).

### REQ-013 — Scan Engine
**Priority:** P0 | **Traces to:** FR6 | **Verified by:** AC1, AC3, AC4

The system shall provide a scan engine that, given a boundary ID, executes the full path discovery and violation detection pipeline and persists the results. The scan engine must be callable on-demand and on a schedule.

- **REQ-013a:** `POST /scans` accepts `{boundary_id, type: "on_demand"}` and initiates an immediate scan, returning a `scan_id` that can be polled for status.
- **REQ-013b:** `GET /scans/{id}` returns the scan status (`pending`, `running`, `completed`, `failed`), start time, end time, and aggregate statistics (resources evaluated, paths discovered, violations found).
- **REQ-013c:** The scan engine shall evaluate all resource types (route tables, security groups, NACLs, VPC endpoints, peerings, TGWs) in parallel within a single boundary and shall evaluate multiple boundaries in parallel across the fleet.

### REQ-014 — Scheduled Scanning
**Priority:** P1 | **Traces to:** FR6 | **Verified by:** AC1, AC4

The system shall support recurring boundary scans on a configurable interval. The minimum supported interval is 1 hour; the maximum is 7 days. The default interval is 6 hours.

- **REQ-014a:** `POST /boundaries/{id}/schedule` accepts `{interval_minutes: 360}` to set the recurring scan interval for that boundary. Setting `interval_minutes: 0` disables scheduled scanning.
- **REQ-014b:** The scheduler shall stagger boundary scans by default (random offset within the first 10% of the interval) to avoid thundering-herd API calls against the cloud provider.
- **REQ-014c:** The scheduler shall respect cloud provider API rate limits. If rate-limited, scans shall be retried with exponential backoff (initial delay 30s, max delay 5 min, up to 3 retries). After 3 failures, the scan is marked `failed` and a `high` severity operational alert is raised.

### REQ-015 — Event-Driven Scanning (CloudTrail / Config)
**Priority:** P2 | **Traces to:** FR6 | **Verified by:** AC3

The system shall optionally subscribe to AWS CloudTrail events (or AWS Config rules) for configuration changes to route tables, security groups, NACLs, VPC endpoints, and peering connections. When a relevant change event is received for a resource within a boundary, the system shall enqueue a targeted scan of that boundary to execute within 5 minutes of the event.

- **REQ-015a:** Event-driven scanning requires the user to configure a CloudTrail trail or EventBridge rule that delivers events to an SQS queue or SNS topic the system subscribes to. Onboarding documentation shall provide the exact EventBridge rule pattern.
- **REQ-015b:** The system shall deduplicate events: if multiple change events arrive for the same boundary within a 60-second window, only one scan is triggered.

### REQ-016 — Violations API
**Priority:** P1 | **Traces to:** FR5, FR8 | **Verified by:** AC5

The system shall expose a REST API to query violations.

- **REQ-016a:** `GET /violations?boundary_id={uuid}` returns all current (unresolved) violations for that boundary, sorted by severity then by resource type. Response time target: ≤2 seconds for cached results (from the most recent completed scan); ≤30 seconds when the `trigger_fresh=true` query parameter forces a new scan before returning.
- **REQ-016b:** `GET /violations?boundary_id={uuid}&severity=critical` filters to the requested severity.
- **REQ-016c:** `GET /violations?scan_id={uuid}` returns the violations from a specific historical scan.
- **REQ-016d:** `GET /violations/{id}` returns a single violation with its full detail and resolution history.

### REQ-017 — Compliance Dashboard
**Priority:** P2 | **Traces to:** FR5 | **Verified by:** AC4

The system shall provide a web dashboard (and a JSON endpoint driving it) that displays:

- Current compliance posture: count of boundaries with zero violations, 1–5 violations, 6–20 violations, and 20+ violations.
- Violation trend over time (past 7, 30, 90 days): stacked bar of violation counts by severity.
- Top 10 violating boundaries ranked by critical + high violation count.
- A detail view for a single boundary showing every current violation with its severity, resource, rule detail, and recommended action.

### REQ-018 — Alerting & Notification Integration
**Priority:** P1 | **Traces to:** FR5 | **Verified by:** AC3

The system shall integrate with common notification channels to alert on new or changed violations.

- **REQ-018a:** **SNS integration:** The system shall publish a message to a customer-configured SNS topic whenever a scan completes and the violation count or severity distribution has changed since the previous scan. The message shall include: boundary name, scan ID, violation count by severity, and a link to the dashboard detail view.
- **REQ-018b:** **Slack webhook integration:** The system shall accept a Slack incoming webhook URL per boundary. When new critical or high-severity violations appear, it shall post a formatted message with the boundary name, violation count, and top 3 violations.
- **REQ-018c:** **SIEM / ticketing integration:** The system shall support exporting violations as a JSON event stream consumable by Splunk, Elastic, or ServiceNow. The export format shall be documented and stable.

### REQ-019 — CLI
**Priority:** P2 | **Traces to:** FR8 | **Verified by:** AC5

The system shall ship a CLI tool (`sandbox-egress`) that supports all API operations offline-capable output:

- `sandbox-egress boundary create|list|show|update|delete`
- `sandbox-egress policy create|list|show|update|delete|associate|dissociate`
- `sandbox-egress scan trigger|status|results`
- `sandbox-egress violations list|show --boundary <id>`
- All commands shall support `--output json` (default) and `--output table` for human consumption.
- The CLI shall read API credentials from environment variables (`SBX_EGRESS_API_KEY`, `SBX_EGRESS_API_URL`) or a config file (`~/.sandbox-egress/config.yaml`).

### REQ-020 — Multi-Account AWS Support
**Priority:** P1 | **Traces to:** FR1, FR7 | **Verified by:** AC4

The system shall support scanning boundaries that span multiple AWS accounts.

- **REQ-020a:** The system shall accept one or more IAM role ARNs that it will assume (via `sts:AssumeRole`) to read network configuration from each account. Each boundary may specify which role to use per account. If no per-account role is specified, the system uses its own execution role.
- **REQ-020b:** Cross-account resource discovery shall respect the principle of least privilege. The system shall require only read-only IAM permissions: `ec2:DescribeRouteTables`, `ec2:DescribeSecurityGroups`, `ec2:DescribeSecurityGroupRules`, `ec2:DescribeNetworkAcls`, `ec2:DescribeVpcEndpoints`, `ec2:DescribeVpcPeeringConnections`, `ec2:DescribeTransitGatewayAttachments`, `ec2:DescribeTransitGatewayRouteTables`, `ec2:DescribeSubnets`, `ec2:DescribeVpcs`, `sts:AssumeRole`.

### REQ-021 — Multi-Cloud Architecture (Azure / GCP Readiness)
**Priority:** P2 | **Traces to:** FR7 | **Verified by:** AC4

The system architecture shall abstract cloud-provider-specific discovery behind a provider interface so that adding Azure and GCP support does not require changes to the policy model, violation engine, or API surface.

- **REQ-021a:** The provider interface shall expose methods: `discover_route_tables(boundary)`, `discover_security_groups(boundary)`, `discover_network_acls(boundary)`, `discover_endpoints(boundary)`, `discover_peerings(boundary)`, `discover_transit_gateways(boundary)`. Each method returns a canonical `EgressPath` struct that is provider-agnostic.
- **REQ-021b:** Azure mapping: Azure Route Tables → `discover_route_tables`, NSG outbound rules → `discover_security_groups`, VNet Peering → `discover_peerings`, Private Endpoints → `discover_endpoints`.
- **REQ-021c:** GCP mapping: GCP Routes → `discover_route_tables`, Firewall rules (egress) → `discover_security_groups`, VPC Peering → `discover_peerings`, Private Service Connect → `discover_endpoints`.

### REQ-022 — Authentication & Authorization
**Priority:** P1 | **Traces to:** FR8 | **Verified by:** AC5

The REST API shall require authentication via API key (header `X-API-Key`) or OAuth 2.0 Bearer token. The API shall enforce role-based access:

- `reader`: Can list boundaries, policies, and violations; can view scan results. Cannot create, update, or delete resources or trigger scans.
- `operator`: Inherits `reader`; can trigger on-demand scans and view all results.
- `admin`: Inherits `operator`; can create/update/delete boundaries and policies; can configure schedules, alert integrations, and cross-account roles.

### REQ-023 — Audit Log
**Priority:** P2 | **Traces to:** FR5 | **Verified by:** AC4

Every mutating action (boundary CRUD, policy CRUD, scan trigger, schedule change, alert config change) shall emit an audit log record containing: timestamp, actor (API key ID or user ID), action, resource type, resource ID, and a JSON diff of the change.

- **REQ-023a:** Audit log records shall be queryable via `GET /audit?resource_type=boundary&resource_id={uuid}&from={ISO}&to={ISO}` and shall be retained for a minimum of 90 days.

### REQ-024 — Scan Performance & Scalability
**Priority:** P1 | **Traces to:** FR3, FR6 | **Verified by:** AC4

The system shall meet the following performance targets:

- **REQ-024a:** A single-boundary scan covering up to 100 resources (route tables, SGs, NACLs, endpoints, peerings) shall complete in under 15 seconds.
- **REQ-024b:** Concurrent scanning of 500 boundaries (each averaging 20 resources) shall complete in under 2 minutes through parallel execution across worker instances.
- **REQ-024c:** The violation-matching engine shall evaluate 50 000 paths against a 1 000-entry allowlist in under 1 second using indexed CIDR matching (binary trie or radix tree).

### REQ-025 — API Response Time
**Priority:** P1 | **Traces to:** FR8 | **Verified by:** AC5

All API endpoints shall meet the following p95 latency targets:

| Endpoint | p95 Target |
|----------|-----------|
| `GET /violations` (cached) | 2 seconds |
| `GET /violations` (fresh scan) | 30 seconds |
| `GET /boundaries` (list) | 500 ms |
| `GET /boundaries/{id}` | 200 ms |
| `POST /scans` (trigger) | 200 ms (acknowledgement) |
| `GET /scans/{id}` | 200 ms |
| All mutation endpoints | 500 ms |

### REQ-026 — Data Retention & Lifecycle
**Priority:** P2 | **Traces to:** FR5 | **Verified by:** AC4

- Scan results shall be retained for 90 days, after which they are deleted by an automated lifecycle policy. Violations that were present in a deleted scan and have never recurred shall be marked as `resolved` with resolution reason `data_retention_expiry`.
- Policy versions shall be retained indefinitely for audit purposes; only the 10 most recent versions shall be served by the list API by default (with a `?all=true` pagination option).

### REQ-027 — Error Handling & Resilience
**Priority:** P1 | **Traces to:** FR3, FR6 | **Verified by:** AC4

- **REQ-027a:** If the cloud provider API returns a throttling error (HTTP 429), the scan shall pause discovery for that resource type and retry after the `Retry-After` period. If throttling persists across 3 retries, the scan shall complete with partial results and the violation report shall include a `scan_warning` indicating which resource types were incomplete.
- **REQ-027b:** If a boundary contains resources in a region where the system does not have credentials or the region is disabled, those resources shall be skipped and the violation report shall include a `scan_warning` per skipped region.
- **REQ-027c:** All API errors shall return a consistent JSON error body: `{error: {code: string, message: string, details?: object}}`. HTTP status codes shall follow RFC 7231 semantics (400 for bad input, 401 for missing auth, 403 for insufficient role, 404 for missing resource, 409 for version conflict, 429 for rate limit, 500 for internal error).

### REQ-028 — Documentation
**Priority:** P2 | **Traces to:** FR1-FR8 | **Verified by:** AC1, AC2, AC3

The system shall ship with:

- An OpenAPI 3.1 specification for the REST API.
- A getting-started guide covering boundary creation, policy definition, scan triggering, and violation review.
- An IAM permissions reference listing the exact policies needed for each cloud provider.
- The CLI reference (`sandbox-egress --help` and man page).
- An architecture decision record (ADR) covering the choice of CIDR matching algorithm and the provider abstraction design.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._