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
 *   • A scheduled-but-never-dispatched audit (the close-audit intent, G08) is a durable
 *     `queued` job bound to its destination, waiting for explicit dispatch.
 */

import {
  destinationKey,
  newLocalRecord,
  UNBOUND_DESTINATION,
  type AuditFindingValue,
  type EntityDestination,
  type LocalFirstStore,
  type LocalRecord,
} from "@builderforce/local-first";
import {
  buildLocalAuditBriefing,
  findingFingerprint,
  getLocalAuditDefinition,
  LOCAL_AUDIT_DEFINITIONS,
  validateAuditFindings,
  type AuditFinding,
  type LocalAuditDefinition,
} from "./auditDefinitions";

export const LOCAL_AUDIT_SCHEMA_VERSION = 1;

/**
 * Same key `localFirstStore` mints (`builderforce.localDeviceId`). Audit writes
 * must stamp that id, not a second one minted here.
 */
export const LOCAL_AUDIT_DEVICE_KEY = "builderforce.localDeviceId";

/** Read the durable device id, minting it into global state before any audit write. */
export async function ensureLocalAuditDeviceId(state: {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}): Promise<string> {
  const existing = state.get<string>(LOCAL_AUDIT_DEVICE_KEY);
  if (existing) return existing;
  const minted = crypto.randomUUID();
  await state.update(LOCAL_AUDIT_DEVICE_KEY, minted);
  return minted;
}

export type LocalAuditRunStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export interface LocalAuditRunValue {
  auditId: string;
  /** Packaged definition version the briefing/findings were produced under. */
  auditVersion: number;
  auditName: string;
  /** Server project id when the run is bound to an account project; absent = unbound. */
  projectId?: number;
  status: LocalAuditRunStatus;
  trigger: "manual" | "startup" | "close";
  briefing: string;
  /** Git/workspace provenance captured at start (branch, commit, dirty, surface). */
  source?: Record<string, unknown>;
  findingsCount: number;
  /** Client entity ids of the remediation records this run filed. */
  remediationIds: string[];
  /** Server run id once a later import binds one; the local id never changes. */
  serverRunId?: string;
  error?: string;
  /** Recovery marker: what a restart may safely do with an interrupted run. */
  checkpoint?: { safeToResume: boolean; note?: string };
}

export interface LocalRemediationValue {
  auditId: string;
  fingerprint: string;
  title: string;
  severity: string;
  location?: string;
  recommendation?: string;
  status: "proposed" | "ticketed" | "resolved";
  /** Local ticket id once the work-management context files one. */
  ticketId?: string;
  /** Server remediation/task id once imported. */
  serverTaskId?: number;
}

export interface LocalAuditRun {
  runId: string;
  record: LocalRecord<LocalAuditRunValue>;
}

/** The destination an audit run binds to: the selected project when known, else the unbound partition. */
export function auditDestination(projectId: number | undefined): EntityDestination {
  return projectId == null ? UNBOUND_DESTINATION : { kind: "bound", projectId: String(projectId) };
}

interface StoreDeps {
  deviceId: string;
  newId?: () => string;
  now?: () => Date;
}

const uuid = (): string => crypto.randomUUID();

async function persistRun(
  store: LocalFirstStore,
  record: LocalRecord<LocalAuditRunValue>,
  operation: "create" | "update",
  eventId: string,
): Promise<void> {
  await store.transact(async (tx) => {
    await tx.put(record, operation === "update" ? record.version - 1 : undefined);
    await tx.append({
      eventId,
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
export async function ensureLocalAuditDefinitions(store: LocalFirstStore, deps: StoreDeps): Promise<void> {
  const stale = await store.read(async (tx) => {
    for (const definition of LOCAL_AUDIT_DEFINITIONS) {
      const current = await tx.get<LocalAuditDefinition>("audit-definition", definition.id);
      if (!current || current.payload.version < definition.version) return true;
    }
    return false;
  });
  if (!stale) return;
  const at = (deps.now?.() ?? new Date()).toISOString();
  await store.transact(async (tx) => {
    for (const definition of LOCAL_AUDIT_DEFINITIONS) {
      const current = await tx.get<LocalAuditDefinition>("audit-definition", definition.id);
      if (current && current.payload.version >= definition.version) continue;
      const record = newLocalRecord<LocalAuditDefinition>({
        id: definition.id,
        entityType: "audit-definition",
        deviceId: deps.deviceId,
        destination: UNBOUND_DESTINATION,
        occurredAt: current?.occurredAt ?? at,
        schemaVersion: LOCAL_AUDIT_SCHEMA_VERSION,
        payload: { ...definition },
      });
      if (current) record.version = current.version + 1;
      record.provenance = { deviceId: deps.deviceId, source: "local", auditVersion: String(definition.version) };
      await tx.put(record, current ? current.version : undefined);
      await tx.append({
        eventId: current
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
export async function loadLocalAuditDefinition(
  store: LocalFirstStore,
  auditId: string,
): Promise<LocalAuditDefinition | undefined> {
  const record = await store.read((tx) => tx.get<LocalAuditDefinition>("audit-definition", auditId));
  return record?.payload;
}

/**
 * Open a durable local audit session. The record and its journal event commit BEFORE
 * the host run starts, so a crash after this point still leaves a truthful
 * `running`/`queued` session to recover — never a silently lost or silently cloud one.
 */
export async function startLocalAuditRun(
  store: LocalFirstStore,
  deps: StoreDeps,
  args: {
    auditId: string;
    projectId?: number;
    trigger: "manual" | "startup" | "close";
    source?: Record<string, unknown>;
    /** Reuse a caller-allocated id (e.g. a close intent's request id) so retries dedupe. */
    runId?: string;
    status?: "queued" | "running";
  },
): Promise<{ runId: string; definition: LocalAuditDefinition; briefing: string }> {
  const definition = await loadLocalAuditDefinition(store, args.auditId) ?? getLocalAuditDefinition(args.auditId);
  if (!definition) throw new Error(`unknown_audit:${args.auditId}`);
  const runId = args.runId ?? deps.newId?.() ?? uuid();
  const briefing = buildLocalAuditBriefing(definition, { runId, projectId: args.projectId, source: args.source });
  const at = (deps.now?.() ?? new Date()).toISOString();
  const existing = await store.read((tx) => tx.get<LocalAuditRunValue>("audit-run", runId));
  if (existing) return { runId, definition, briefing: existing.payload.briefing };
  const record = newLocalRecord<LocalAuditRunValue>({
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
export async function saveLocalAuditFindings(
  store: LocalFirstStore,
  deps: StoreDeps,
  args: { runId: string; findings: unknown; analysis?: unknown },
): Promise<{ runId: string; completed: true; findings: AuditFinding[]; errors: string[]; remediationIds: string[] }> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  return store.transact(async (tx) => {
    const run = await tx.get<LocalAuditRunValue>("audit-run", args.runId);
    if (!run) throw new Error(`unknown_audit_run:${args.runId}`);
    const existingFindings = (await tx.list<AuditFindingValue>("audit-finding"))
      .filter((finding) => finding.payload.auditRunId === args.runId);
    if (run.payload.status === "completed" || existingFindings.length > 0) {
      return {
        runId: args.runId,
        completed: true as const,
        findings: existingFindings.map((finding) => finding.payload.evidence as AuditFinding),
        errors: [],
        remediationIds: run.payload.remediationIds,
      };
    }

    const { findings, errors } = validateAuditFindings(args.findings);
    const remediationIds: string[] = [];
    const remediations = (await tx.list<LocalRemediationValue>("remediation"))
      .filter((record) => destinationEquals(record.destination, run.destination));

    for (const finding of findings) {
      const fingerprint = findingFingerprint(run.payload.auditId, finding);
      const findingId = `audit-finding:${args.runId}:${fingerprint}`;
      const findingRecord = newLocalRecord<AuditFindingValue>({
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
        eventId: `audit-finding:create:${findingId}`,
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
      if ((finding.severity ?? "medium") === "info") continue;
      const remediationId = `remediation:${run.payload.auditId}:${fingerprint}`;
      if (!remediations.some((record) => record.id === remediationId) && !remediationIds.includes(remediationId)) {
        const remediation = newLocalRecord<LocalRemediationValue>({
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
          eventId: `remediation:create:${remediationId}`,
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

    await tx.put<LocalAuditRunValue>(
      {
        ...run,
        version: run.version + 1,
        updatedAt: at,
        payload: { ...run.payload, status: "completed", findingsCount: findings.length, remediationIds, error: undefined },
      },
      run.version,
    );
    await tx.append({
      eventId: `audit-run:complete:${args.runId}`,
      clientEntityId: args.runId,
      entityType: "audit-run",
      operation: "update",
      schemaVersion: run.schemaVersion,
      occurredAt: at,
      dependsOn: [],
      destination: run.destination,
      payload: { status: "completed", findingsCount: findings.length, remediationIds },
    });
    return { runId: args.runId, completed: true as const, findings, errors, remediationIds };
  });
}

/** Mark a run failed/interrupted with a checkpoint. Recovery markers never auto-replay. */
export async function markLocalAuditRun(
  store: LocalFirstStore,
  deps: StoreDeps,
  args: { runId: string; status: "failed" | "interrupted"; error?: string; safeToResume?: boolean },
): Promise<void> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  await store.transact(async (tx) => {
    const run = await tx.get<LocalAuditRunValue>("audit-run", args.runId);
    if (!run || run.payload.status === "completed") return;
    await tx.put<LocalAuditRunValue>(
      {
        ...run,
        version: run.version + 1,
        updatedAt: at,
        payload: {
          ...run.payload,
          status: args.status,
          ...(args.error ? { error: args.error } : {}),
          checkpoint: { safeToResume: args.safeToResume ?? false, ...(args.error ? { note: args.error } : {}) },
        },
      },
      run.version,
    );
    await tx.append({
      eventId: `audit-run:${args.status}:${args.runId}:${at}`,
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
export async function recoverInterruptedAuditRuns(store: LocalFirstStore, deps: StoreDeps): Promise<LocalAuditRun[]> {
  const stale = await store.read(async (tx) =>
    (await tx.list<LocalAuditRunValue>("audit-run")).filter((record) => record.payload.status === "running"),
  );
  for (const record of stale) {
    await markLocalAuditRun(store, deps, { runId: record.id, status: "interrupted", error: "The extension host stopped before this audit finished." });
  }
  return store.read(async (tx) =>
    (await tx.list<LocalAuditRunValue>("audit-run"))
      .filter((record) => record.payload.status === "interrupted")
      .map((record) => ({ runId: record.id, record })),
  );
}

/** One local audit session, for completion checks and result rendering. */
export async function getLocalAuditRun(store: LocalFirstStore, runId: string): Promise<LocalAuditRun | undefined> {
  const record = await store.read((tx) => tx.get<LocalAuditRunValue>("audit-run", runId));
  return record ? { runId, record } : undefined;
}

/** Every local audit session, newest first — the offline audit history. */
export async function listLocalAuditRuns(store: LocalFirstStore): Promise<LocalAuditRun[]> {
  const runs = await store.read((tx) => tx.list<LocalAuditRunValue>("audit-run"));
  return runs
    .map((record) => ({ runId: record.id, record }))
    .sort((a, b) => b.record.occurredAt.localeCompare(a.record.occurredAt));
}

/** The findings of one run, in submission order. */
export async function listLocalAuditFindings(store: LocalFirstStore, runId: string): Promise<AuditFindingValue[]> {
  const findings = await store.read((tx) => tx.list<AuditFindingValue>("audit-finding"));
  return findings.filter((record) => record.payload.auditRunId === runId).map((record) => record.payload);
}

function destinationEquals(a: EntityDestination, b: EntityDestination): boolean {
  return destinationKey(a) === destinationKey(b);
}
