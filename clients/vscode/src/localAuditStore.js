/**
 * Local assurance records — the durable half of G07/G08/G22 for audits.
 *
 * A system audit started in this editor is a LOCAL entity first: its session, findings,
 * evidence and remediation identities commit to the transactional local-first store in
 * the same operation that journals their sync events, with no server chat/session/
 * briefing/completion round trip. Account import happens later, from the journal,
 * without rerunning the audit.
 *
 * Invariants kept here:
 *
 *   • Findings are IMMUTABLE once a run is completed — a retried report returns the
 *     stored result instead of double-filing (mirrors the server's `reportFindings`).
 *   • Remediation identity is the server-canonical finding fingerprint, so a local
 *     ticket and a later cloud remediation for the same finding converge on one record.
 *   • A run the host never finished is recovered as `interrupted`, never silently
 *     completed or re-run (G22); re-running is an explicit new run.
 *   • Closing an audit (G08) is a local completion: `closedLocally` is durable, the
 *     session is not re-executed, and close never becomes a cloud launch.
 */
import { destinationKey, newLocalRecord, UNBOUND_DESTINATION, } from "@builderforce/local-first";
import { buildLocalAuditBriefing, findingFingerprint, getLocalAuditDefinition, LOCAL_AUDIT_DEFINITIONS, validateAuditFindings, } from "./auditDefinitions";
export const LOCAL_AUDIT_SCHEMA_VERSION = 1;
/**
 * Same key `localFirstStore` mints (`builderforce.localDeviceId`). Audit writes
 * must stamp that id, not a second one minted here.
 */
export const LOCAL_AUDIT_DEVICE_KEY = "builderforce.localDeviceId";
/** Read the durable device id, minting it into global state before any audit write. */
export async function ensureLocalAuditDeviceId(state) {
    const existing = state.get(LOCAL_AUDIT_DEVICE_KEY);
    if (existing)
        return existing;
    const minted = crypto.randomUUID();
    await state.update(LOCAL_AUDIT_DEVICE_KEY, minted);
    return minted;
}
/** The destination an audit run binds to: the selected project when known, else the unbound partition. */
export function auditDestination(projectId) {
    return projectId == null ? UNBOUND_DESTINATION : { kind: "bound", projectId: String(projectId) };
}
const uuid = () => crypto.randomUUID();
/** One audit-run write and its journal event, in one transaction (also the finalize gate's, `localAuditGate.ts`). */
export async function persistRun(store, record, operation, eventId) {
    await store.transact(async (tx) => {
        await tx.put(record, operation === "update" ? record.version - 1 : undefined);
        await tx.append({
            idempotencyKey: eventId,
            clientEntityId: record.id,
            entityType: "audit-run",
            operation,
            schemaVersion: record.schemaVersion,
            occurredAt: record.updatedAt,
            dependsOn: [],
            destination: record.destination,
            payload: record.payload,
        });
    });
}
/**
 * Copy packaged definitions into the local store. A stored copy at the same or a
 * newer definition version is left alone, so a later load sees the store, not a
 * fresh read of the package.
 */
export async function ensureLocalAuditDefinitions(store, deps) {
    const stale = await store.read(async (tx) => {
        for (const definition of LOCAL_AUDIT_DEFINITIONS) {
            const current = await tx.get("audit-definition", definition.id);
            if (!current || current.payload.version < definition.version)
                return true;
        }
        return false;
    });
    if (!stale)
        return;
    const at = (deps.now?.() ?? new Date()).toISOString();
    await store.transact(async (tx) => {
        for (const definition of LOCAL_AUDIT_DEFINITIONS) {
            const current = await tx.get("audit-definition", definition.id);
            if (current && current.payload.version >= definition.version)
                continue;
            const record = newLocalRecord({
                id: definition.id,
                entityType: "audit-definition",
                deviceId: deps.deviceId,
                destination: UNBOUND_DESTINATION,
                occurredAt: current?.occurredAt ?? at,
                schemaVersion: LOCAL_AUDIT_SCHEMA_VERSION,
                payload: { ...definition },
            });
            if (current)
                record.version = current.version + 1;
            record.provenance = { deviceId: deps.deviceId, source: "local", auditVersion: String(definition.version) };
            await tx.put(record, current ? current.version : undefined);
            await tx.append({
                idempotencyKey: current
                    ? `audit-definition:update:${definition.id}:v${record.version}`
                    : `audit-definition:create:${definition.id}`,
                clientEntityId: definition.id,
                entityType: "audit-definition",
                operation: current ? "update" : "create",
                schemaVersion: record.schemaVersion,
                occurredAt: at,
                dependsOn: [],
                destination: record.destination,
                payload: record.payload,
            });
        }
    });
}
/** The definition a live audit run must use — the store copy, not the package constant. */
export async function loadLocalAuditDefinition(store, auditId) {
    const record = await store.read((tx) => tx.get("audit-definition", auditId));
    return record?.payload;
}
/**
 * Open a durable local audit session. The record and its journal event commit BEFORE
 * the host run starts, so a crash after this point still leaves a truthful
 * `running`/`queued` session to recover — never a silently lost or silently cloud one.
 */
export async function startLocalAuditRun(store, deps, args) {
    const definition = await loadLocalAuditDefinition(store, args.auditId) ?? getLocalAuditDefinition(args.auditId);
    if (!definition)
        throw new Error(`unknown_audit:${args.auditId}`);
    const runId = args.runId ?? deps.newId?.() ?? uuid();
    const briefing = buildLocalAuditBriefing(definition, { runId, projectId: args.projectId, source: args.source });
    const at = (deps.now?.() ?? new Date()).toISOString();
    const existing = await store.read((tx) => tx.get("audit-run", runId));
    if (existing)
        return { runId, definition, briefing: existing.payload.briefing };
    const record = newLocalRecord({
        id: runId,
        entityType: "audit-run",
        deviceId: deps.deviceId,
        destination: auditDestination(args.projectId),
        occurredAt: at,
        schemaVersion: LOCAL_AUDIT_SCHEMA_VERSION,
        payload: {
            auditId: definition.id,
            auditVersion: definition.version,
            auditName: definition.name,
            ...(args.projectId != null ? { projectId: args.projectId } : {}),
            status: args.status ?? "running",
            trigger: args.trigger,
            briefing,
            ...(args.source ? { source: args.source } : {}),
            findingsCount: 0,
            remediationIds: [],
        },
    });
    record.provenance = { ...record.provenance, auditVersion: String(definition.version), deviceId: deps.deviceId, source: "local" };
    await persistRun(store, record, "create", `audit-run:create:${runId}`);
    return { runId, definition, briefing };
}
/**
 * Persist a submitted report: validated findings as immutable evidence plus one
 * remediation identity per actionable finding, deduped by the server-canonical
 * fingerprint so re-reports and cloud/local convergence never double-file.
 *
 * A completed run is a no-op that returns its stored result — retries must not
 * re-penalize a score or duplicate tickets.
 */
export async function saveLocalAuditFindings(store, deps, args) {
    const at = (deps.now?.() ?? new Date()).toISOString();
    return store.transact(async (tx) => {
        const run = await tx.get("audit-run", args.runId);
        if (!run)
            throw new Error(`unknown_audit_run:${args.runId}`);
        const existingFindings = (await tx.list("audit-finding"))
            .filter((finding) => finding.payload.auditRunId === args.runId);
        if (run.payload.status === "completed" || existingFindings.length > 0) {
            return {
                runId: args.runId,
                completed: true,
                findings: existingFindings.map((finding) => finding.payload.evidence),
                errors: [],
                remediationIds: run.payload.remediationIds,
            };
        }
        const { findings, errors } = validateAuditFindings(args.findings);
        const remediationIds = [];
        const remediations = (await tx.list("remediation"))
            .filter((record) => destinationEquals(record.destination, run.destination));
        for (const finding of findings) {
            const fingerprint = findingFingerprint(run.payload.auditId, finding);
            const findingId = `audit-finding:${args.runId}:${fingerprint}`;
            const findingRecord = newLocalRecord({
                id: findingId,
                entityType: "audit-finding",
                deviceId: deps.deviceId,
                destination: run.destination,
                occurredAt: at,
                schemaVersion: LOCAL_AUDIT_SCHEMA_VERSION,
                payload: {
                    auditRunId: args.runId,
                    fingerprint,
                    severity: finding.severity ?? "medium",
                    summary: finding.title,
                    evidence: { ...finding, ...(args.analysis ? { analysis: args.analysis } : {}) },
                },
            });
            await tx.put(findingRecord);
            await tx.append({
                idempotencyKey: `audit-finding:create:${findingId}`,
                clientEntityId: findingId,
                entityType: "audit-finding",
                operation: "create",
                schemaVersion: findingRecord.schemaVersion,
                occurredAt: at,
                dependsOn: [`audit-run:create:${args.runId}`],
                destination: run.destination,
                payload: findingRecord.payload,
            });
            // `info` findings are observations on the record, not remediation obligations
            // (mirrors the server, which skips them in ensureRemediationTickets).
            if ((finding.severity ?? "medium") === "info")
                continue;
            const remediationId = `remediation:${run.payload.auditId}:${fingerprint}`;
            if (!remediations.some((record) => record.id === remediationId) && !remediationIds.includes(remediationId)) {
                const remediation = newLocalRecord({
                    id: remediationId,
                    entityType: "remediation",
                    deviceId: deps.deviceId,
                    destination: run.destination,
                    occurredAt: at,
                    schemaVersion: LOCAL_AUDIT_SCHEMA_VERSION,
                    payload: {
                        auditId: run.payload.auditId,
                        fingerprint,
                        title: `${run.payload.auditName}: ${finding.title}`,
                        severity: finding.severity ?? "medium",
                        ...(finding.location ? { location: finding.location } : {}),
                        ...(finding.recommendation ? { recommendation: finding.recommendation } : {}),
                        status: "proposed",
                    },
                });
                await tx.put(remediation);
                await tx.append({
                    idempotencyKey: `remediation:create:${remediationId}`,
                    clientEntityId: remediationId,
                    entityType: "remediation",
                    operation: "create",
                    schemaVersion: remediation.schemaVersion,
                    occurredAt: at,
                    dependsOn: [`audit-finding:create:${findingId}`],
                    destination: run.destination,
                    payload: remediation.payload,
                });
            }
            remediationIds.push(remediationId);
        }
        await tx.put({
            ...run,
            version: run.version + 1,
            updatedAt: at,
            payload: { ...run.payload, status: "completed", findingsCount: findings.length, remediationIds, error: undefined },
        }, run.version);
        await tx.append({
            idempotencyKey: `audit-run:complete:${args.runId}`,
            clientEntityId: args.runId,
            entityType: "audit-run",
            operation: "update",
            schemaVersion: run.schemaVersion,
            occurredAt: at,
            dependsOn: [],
            destination: run.destination,
            payload: { status: "completed", findingsCount: findings.length, remediationIds },
        });
        return { runId: args.runId, completed: true, findings, errors, remediationIds };
    });
}
const CLOSED_LOCALLY_NOTE = "Closed locally. A cloud audit was not launched.";
/**
 * G08: closing an audit is a local completion. Persists `closedLocally` and does not
 * start a host run or a cloud audit. An existing session is stamped, not re-executed.
 * A close with no session is recorded completed locally so a later activation cannot
 * turn the same request id into a cloud launch.
 */
export async function closeLocalAuditRun(store, deps, args) {
    const at = (deps.now?.() ?? new Date()).toISOString();
    const existing = await store.read((tx) => tx.get("audit-run", args.runId));
    if (existing?.payload.closedLocally)
        return { runId: args.runId, closedLocally: true };
    if (!existing) {
        const definition = await loadLocalAuditDefinition(store, args.auditId) ?? getLocalAuditDefinition(args.auditId);
        if (!definition)
            throw new Error(`unknown_audit:${args.auditId}`);
        const briefing = buildLocalAuditBriefing(definition, { runId: args.runId, projectId: args.projectId, source: args.source });
        const record = newLocalRecord({
            id: args.runId,
            entityType: "audit-run",
            deviceId: deps.deviceId,
            destination: auditDestination(args.projectId),
            occurredAt: at,
            schemaVersion: LOCAL_AUDIT_SCHEMA_VERSION,
            payload: {
                auditId: definition.id,
                auditVersion: definition.version,
                auditName: definition.name,
                ...(args.projectId != null ? { projectId: args.projectId } : {}),
                status: "completed",
                trigger: "close",
                briefing,
                ...(args.source ? { source: args.source } : {}),
                findingsCount: 0,
                remediationIds: [],
                closedLocally: true,
                checkpoint: { safeToResume: false, note: CLOSED_LOCALLY_NOTE },
            },
        });
        record.provenance = { ...record.provenance, auditVersion: String(definition.version), deviceId: deps.deviceId, source: "local" };
        await persistRun(store, record, "create", `audit-run:close:${args.runId}`);
        return { runId: args.runId, closedLocally: true };
    }
    await store.transact(async (tx) => {
        const run = await tx.get("audit-run", args.runId);
        if (!run || run.payload.closedLocally)
            return;
        const finished = run.payload.status === "completed";
        const status = finished ? "completed" : "interrupted";
        await tx.put({
            ...run,
            version: run.version + 1,
            updatedAt: at,
            payload: {
                ...run.payload,
                status,
                closedLocally: true,
                checkpoint: finished
                    ? (run.payload.checkpoint ?? { safeToResume: false, note: CLOSED_LOCALLY_NOTE })
                    : { safeToResume: false, note: CLOSED_LOCALLY_NOTE },
            },
        }, run.version);
        await tx.append({
            idempotencyKey: `audit-run:close:${args.runId}:${at}`,
            clientEntityId: args.runId,
            entityType: "audit-run",
            operation: "update",
            schemaVersion: run.schemaVersion,
            occurredAt: at,
            dependsOn: [],
            destination: run.destination,
            payload: { status, closedLocally: true },
        });
    });
    return { runId: args.runId, closedLocally: true };
}
/** Mark a run failed/interrupted with a checkpoint. Recovery markers never auto-replay. */
export async function markLocalAuditRun(store, deps, args) {
    const at = (deps.now?.() ?? new Date()).toISOString();
    await store.transact(async (tx) => {
        const run = await tx.get("audit-run", args.runId);
        if (!run || run.payload.status === "completed")
            return;
        await tx.put({
            ...run,
            version: run.version + 1,
            updatedAt: at,
            payload: {
                ...run.payload,
                status: args.status,
                ...(args.error ? { error: args.error } : {}),
                checkpoint: { safeToResume: args.safeToResume ?? false, ...(args.error ? { note: args.error } : {}) },
            },
        }, run.version);
        await tx.append({
            idempotencyKey: `audit-run:${args.status}:${args.runId}:${at}`,
            clientEntityId: args.runId,
            entityType: "audit-run",
            operation: "update",
            schemaVersion: run.schemaVersion,
            occurredAt: at,
            dependsOn: [],
            destination: run.destination,
            payload: { status: args.status, error: args.error },
        });
    });
}
/**
 * Activation recovery: every session still `running` or `queued-as-running` when the
 * host died becomes `interrupted` with `safeToResume: false` — a source-review run is
 * never auto-replayed, and a partially written report is never presented as complete.
 * Returns the recovered runs so the caller can surface them.
 */
export async function recoverInterruptedAuditRuns(store, deps) {
    const stale = await store.read(async (tx) => (await tx.list("audit-run")).filter((record) => record.payload.status === "running"));
    for (const record of stale) {
        await markLocalAuditRun(store, deps, { runId: record.id, status: "interrupted", error: "The extension host stopped before this audit finished." });
    }
    return store.read(async (tx) => (await tx.list("audit-run"))
        .filter((record) => record.payload.status === "interrupted")
        .map((record) => ({ runId: record.id, record })));
}
/** One local audit session, for completion checks and result rendering. */
export async function getLocalAuditRun(store, runId) {
    const record = await store.read((tx) => tx.get("audit-run", runId));
    return record ? { runId, record } : undefined;
}
/** Every local audit session, newest first — the offline audit history. */
export async function listLocalAuditRuns(store) {
    const runs = await store.read((tx) => tx.list("audit-run"));
    return runs
        .map((record) => ({ runId: record.id, record }))
        .sort((a, b) => b.record.occurredAt.localeCompare(a.record.occurredAt));
}
/** The findings of one run, in submission order. */
export async function listLocalAuditFindings(store, runId) {
    const findings = await store.read((tx) => tx.list("audit-finding"));
    return findings.filter((record) => record.payload.auditRunId === runId).map((record) => record.payload);
}
function destinationEquals(a, b) {
    return destinationKey(a) === destinationKey(b);
}
//# sourceMappingURL=localAuditStore.js.map