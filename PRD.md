> **PRD** — drafted by Ada (Sr. Product Mgr) · task #569
> _Each agent that updates this PRD signs its change below._

# Evidence References (Logs, Config Snapshots, Probe Results)

## Problem & Goal
Investigations, audits, and incident response are slowed by evidence scattered across siloed tools. Logs, configuration snapshots, and probe results lack a common reference model, making correlation and traceability manual and error-prone. The goal is to provide a unified, lightweight mechanism to attach, reference, and retrieve operational evidence within the platform, ensuring every decision or finding is backed by a non-repudiable, auditable trail.

## Target Users / ICP Roles
- **Site Reliability Engineers (SREs)** – attaching logs/configs to incident timelines.
- **Security Analysts** – collecting forensic evidence during IR.
- **Compliance Auditors** – reviewing evidence for control attestations.
- **Platform/DevOps Engineers** – linking probe results to change tickets.
- **Ideal Customer Profile** – organisations with ≥50 engineers, regulated industries, or mature observability practices.

## Scope
- A central evidence referencing service that ingests, stores, and links evidence (logs, config snapshots, probe results) to platform entities (incidents, changes, audits).
- Immutable evidence records with metadata and provenance.
- Manual addition (copy-paste, file upload) and API-driven ingestion.
- Search, filter, and retrieval of evidence references by context, type, time range.
- Basic rendering of evidence content (plain text, syntax highlighting).
- Role-based access control and evidence integrity (hash, signatures).
- Short- to medium-term retention governed by policy.

## Functional Requirements
1. **Evidence Types** – Support log excerpts, full configuration snapshots, and probe/check result payloads (plain text, JSON, YAML, structured formats).
2. **Context Association** – Bind each evidence reference to one or more context identifiers (e.g., incident ID, change request, audit trail UUID).
3. **Evidence Creation**  
   - Manual: UI with text editor or file upload.  
   - Programmatic: REST API accepting evidence payload along with context and type.  
   - Webhook integration for automated attachment from alerting or monitoring tools.
4. **Metadata & Immutability** – Automatically capture:
   - Capture timestamp  
   - Ingested-by user or system identity  
   - Original source system  
   - Evidence type  
   - Content hash (SHA-256) for integrity  
   - Optional custom tags  
   Once created, an evidence record is immutable (no editing of content).
5. **Search & Filter** – Query by context ID, evidence type, date range, source, tags. Full-text search within content optional (basic keyword index).
6. **Viewing** – Inline display of evidence with line numbers, syntax highlighting (if format detected), collapsible long content. Show metadata pane.
7. **Export** – Export selection as a bundled report (PDF/JSON) with integrity hashes.
8. **Permissions** – Roles: Evidence Viewer, Evidence Creator, Admin. Fine-grained access can be scoped by project/team contexts.
9. **Retention** – Configurable per evidence type or context; evidence soft-deleted after expiration; audit log retains deletion event.

## Acceptance Criteria
- A user can attach a log snippet to an incident via UI; the evidence record is created, stored, and displayed with all metadata.
- API endpoint accepts evidence payload, returns a reference ID and content hash; subsequent GET retrieves identical content and metadata.
- Evidence objects cannot be modified (write-once); attempted modification returns 403.
- Search returns results within 2 seconds for up to 10,000 references; pagination supported.
- Evidence references are exportable with hashes; imported bundle validates integrity.
- Deleting evidence via UI/API marks it as retired and logs the action; standard users cannot permanently purge.
- RBAC: user without “Evidence Viewer” role cannot fetch evidence for a context.
- Webhook ingestion: when an alert system sends a probe result JSON, a new evidence reference is linked to the specified ticket ID.

## Out of Scope
- Real-time log streaming or historical log analytics (e.g., ELK stack).
- Automatic collection of evidence without explicit trigger (no agent-based scraping).
- Full configuration management DB (CMDB) integration (references only, not diffing or versioning configurations).
- Probes execution or scheduling (only result consumption).
- Long-term archival (beyond 90 days) or cold storage (handled by external data lake).
- Advanced content redaction, correlation, or anomaly detection on evidence data.

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