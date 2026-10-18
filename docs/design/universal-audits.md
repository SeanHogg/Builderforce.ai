# Universal audits

Web, VSIX and Rovr use the catalog in `systemAudits.ts` and the same run, findings,
report and remediation lifecycle. Apply migration `1243_system_audit_runs.sql`
before running the updated API. No third-party analyzer installation is required.

## Execution

- Web and Rovr dispatch a cloud source-review task directly through the existing
  cloud dispatcher. Execution controls, entitlements and governance gates apply.
  Dispatch refusals are returned and stored as a blocked run.
- VSIX starts a separate Brain chat in the extension host with the selected audit's
  checklist and local workspace access. It can read source and request approval to
  run existing commands. Editing and delegation tools are excluded. Its host-bound
  `save_audit_findings` tool saves results for the correct project and run.
- Finishing a VSIX audit opens its report with remediation ticket links. The chat
  remains in Sessions. Cloud completion notifies the initiating user with a Web link.
- Preview scores are provisional. Completed reports use their own run and original
  baseline, so overlapping runs and retries do not compound score penalties.

## VSIX settings

`builderforce.audits.atStartup` and `builderforce.audits.atClose` default to false.
`builderforce.audits.selected` defaults to `quality-audit`. Automatic work requires
a trusted workspace.

Startup audits run locally. Close audits use the connected repository in the cloud;
local edits are not uploaded. Close intent is persisted while the editor is active
and submitted during deactivation. An interrupted submission retries on the next
startup with the same request UUID. Shutdown completion cannot depend on the closing
extension host. Closing an audit chat tab does not stop its host-owned run.

## Persistence and remediation

`system_audit_runs` records source context, executor, status, baseline, findings,
cloud execution, report and remediation ticket IDs. Findings are saved before
ticket creation. Failed completion stays `remediation_pending`; the frequent
`audit-remediation` sweep retries it. A lease prevents concurrent completion writers.

Each actionable finding creates or links a ticket. Informational findings and clean
passes create no remediation work. Fingerprints use audit type, normalized title and
source location without line numbers. A leased identity and a marker on the task
recover a task created before its link was saved. Existing open tickets are reused;
recurrence after closure creates fresh remediation. Auditing does not automatically
apply fixes or close remediation tickets.

## API and agent tools

- `GET /api/tools/audits`: shared catalog.
- `POST /api/tools/audits/:auditId/run`: `projectId`, optional `executor`, `source`,
  and idempotent `requestId`; returns the run and dispatch outcome.
- `GET /api/tools/audits/:auditId/runs/:runId?projectId=...`: status, findings,
  source context, saved report and remediation ticket IDs.
- `POST /api/tools/audits/:auditId/findings`: `projectId`, `runId`, `findings`.
  Legacy agents may omit `runId` only when exactly one eligible run exists.

Web and Rovr agents use `audits.list`, `audits.run`, `audits.get_run` and
`audits.report_findings` through the platform catalog. Cloud coding agents receive
the read/report tools without the generic launch tool. Rovr has a localized audit
starter. Architecture launches use the shared pipeline; existing artifact repair
remains available.

## Measured code visualizer

Apply `1246_audit_analysis_snapshot.sql` as well as `1243_system_audit_runs.sql`.
Architecture and quality agents use the shared `analyze_codebase` tool:

- dependency-cruiser 16.10.4 measures JS/TS dependency edges and cycles.
- jscpd 4.0.5 reports matching source blocks and their line ranges.
- Knip 5.30.0 reports unused file, export and dependency candidates. Candidates
  require review against dynamic entry points and public APIs before deletion.
- TypeScript 5.6.3 is pinned alongside the TypeScript analyzers for compatibility.

The shell-backed tool uses `npm exec` with pinned packages from npm cache, downloading
them on first use. It does not add dependencies to the audited project's manifest.
Generated artifacts live under `.builderforce/code-analysis/<snapshot UUID>`; concurrent
scans do not share output files. An optional relative `path` scopes a scan to a package.
A shell-capable cloud executor is required; a shell-free Worker cannot run these CLIs.

Web reports and VSIX audit result tabs share `CodeAuditVisualizer`: a component/file
dependency graph with pan, zoom, path filtering, cycle highlights and an inspector;
duplicate ranges and excerpts; unused candidates; and before/after metrics plus
added, resolved and unchanged findings. VSIX source links open the editor; historical
committed locations open the corresponding Git content. GitHub links on Web use the
recorded commit. Historical uncommitted source is not represented as committed code.

Analyzer snapshots are saved before completion and survive remediation retries.
Cloud containers and Actions runners upload the artifact through an authenticated,
execution-scoped op before returning a bounded summary to the model. The graph does
not depend on a model copying thousands of dependency edges into a tool argument.
Reports embed the preceding matching project/audit/branch/repository/scope snapshot
as an immutable baseline. The first scan establishes the baseline. Incomplete coverage
or differing analyzer versions cannot turn missing findings into claimed fixes.
Analyzer findings also create remediation tickets; an agent narrative cannot omit them.
