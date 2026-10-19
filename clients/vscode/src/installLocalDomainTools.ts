/**
 * Local domain-tool install (G06).
 *
 * When the platform is denied, a supported domain tool writes a local project
 * or ticket (or a memory fact) and appends its sync event in the same
 * transaction. It does not call the platform client. The host wires one line:
 *
 *   return installLocalDomainTools(ctx).execute(request);
 *
 * extension.ts does not install this yet. The library is idempotent per host
 * context and reuses the device id the host already holds.
 */
import { createFactStore } from "../../../packages/local-first/src/factProvenance.ts";
import type { EntityDestination, LocalRecord } from "../../../packages/local-first/src/records.ts";
import {
  newLocalRecord,
  type LocalFirstStore,
} from "../../../packages/local-first/src/store.ts";

export const LOCAL_DOMAIN_TOOLS = ["project-create", "ticket-create", "memory-recall"] as const;

export type LocalDomainTool = (typeof LOCAL_DOMAIN_TOOLS)[number];

const LOCAL_DOMAIN_TOOL_SET: ReadonlySet<string> = new Set(LOCAL_DOMAIN_TOOLS);

export function isLocalDomainTool(name: string): name is LocalDomainTool {
  return LOCAL_DOMAIN_TOOL_SET.has(name);
}

export interface DomainToolRequest {
  tool: LocalDomainTool;
  args: Record<string, unknown>;
  runId?: string;
  occurredAt?: string;
  destination?: EntityDestination;
}

export type DomainToolResult =
  | { kind: "local"; tool: LocalDomainTool; id: string; record: LocalRecord }
  | { kind: "platform"; tool: LocalDomainTool; value: unknown }
  | { kind: "refused"; reason: "not_a_local_domain_tool" };

const REFUSED_NOT_LOCAL = Object.freeze({
  kind: "refused" as const,
  reason: "not_a_local_domain_tool" as const,
});

export interface LocalDomainToolPorts {
  getConfig?(key: string): unknown;
  localDeviceId?: string;
  localFirstStore?: LocalFirstStore;
  policyAllows?: boolean;
  platformTool?(request: DomainToolRequest): Promise<unknown>;
}

export interface InstalledLocalDomainTools {
  execute(request: DomainToolRequest): Promise<DomainToolResult>;
}

/** The only line a host needs. extension.ts does not call it yet. */
export const HOST_DOMAIN_TOOL_LINE = "return installLocalDomainTools(ctx).execute(request);";

const INSTALLED = new WeakMap<object, InstalledLocalDomainTools>();

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requireText(value: unknown, code: string): string {
  const trimmed = text(value);
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function entityId(value: unknown): string {
  const id = text(value);
  return id || crypto.randomUUID();
}

function deviceIdOf(ports: LocalDomainToolPorts): string {
  const fromConfig = ports.getConfig?.("builderforce.localDeviceId");
  const configured = typeof fromConfig === "string" ? fromConfig.trim() : "";
  if (configured) return configured;
  const held = ports.localDeviceId?.trim();
  if (held) return held;
  throw new Error("local_device_id_required");
}

function storeOf(ports: LocalDomainToolPorts): LocalFirstStore {
  if (!ports.localFirstStore) throw new Error("local_first_store_required");
  return ports.localFirstStore;
}

async function queueCreate(
  store: LocalFirstStore,
  record: LocalRecord,
): Promise<LocalRecord> {
  await store.transact(async (tx) => {
    await tx.put(record);
    await tx.append({
      eventId: `${record.entityType}:${record.id}:v${record.version}`,
      clientEntityId: record.id,
      entityType: record.entityType,
      operation: "create",
      schemaVersion: record.schemaVersion,
      occurredAt: record.occurredAt,
      dependsOn: [],
      destination: record.destination,
      payload: record.payload,
    });
  });
  return record;
}

async function writeProject(
  store: LocalFirstStore,
  request: DomainToolRequest,
  deviceId: string,
): Promise<LocalRecord> {
  const name = requireText(request.args.name, "project_name_required");
  const key = text(request.args.key);
  const status = text(request.args.status);
  const record = newLocalRecord({
    id: entityId(request.args.id),
    entityType: "project",
    payload: {
      name,
      ...(key ? { key } : {}),
      ...(status ? { status } : {}),
    },
    deviceId,
    destination: request.destination,
    occurredAt: request.occurredAt,
  });
  return queueCreate(store, record);
}

async function writeTicket(
  store: LocalFirstStore,
  request: DomainToolRequest,
  deviceId: string,
): Promise<LocalRecord> {
  const projectId = requireText(request.args.projectId, "project_id_required");
  const title = requireText(request.args.title, "ticket_title_required");
  const description = text(request.args.description);
  const status = text(request.args.status) || "todo";
  const priority = text(request.args.priority);
  const parentTicketId = text(request.args.parentTicketId);
  return store.transact(async (tx) => {
    const project = await tx.get("project", projectId);
    if (!project) {
      throw Object.assign(new Error("project_not_found"), { code: "project_not_found" });
    }
    const record = newLocalRecord({
      id: entityId(request.args.id),
      entityType: "ticket",
      payload: {
        projectId,
        title,
        status,
        ...(description ? { description } : {}),
        ...(priority ? { priority } : {}),
        ...(parentTicketId ? { parentTicketId } : {}),
      },
      deviceId,
      destination: project.destination,
      occurredAt: request.occurredAt,
    });
    await tx.put(record);
    await tx.append({
      eventId: `ticket:${record.id}:v${record.version}`,
      clientEntityId: record.id,
      entityType: "ticket",
      operation: "create",
      schemaVersion: record.schemaVersion,
      occurredAt: record.occurredAt,
      dependsOn: [],
      destination: record.destination,
      payload: record.payload,
    });
    return record;
  });
}

async function writeFact(
  store: LocalFirstStore,
  request: DomainToolRequest,
  deviceId: string,
): Promise<LocalRecord> {
  const id = entityId(request.args.id);
  const sourceMessageId = text(request.args.sourceMessageId);
  await createFactStore(store).remember({
    id,
    key: requireText(request.args.key, "fact_key_required"),
    statement: requireText(request.args.statement, "fact_statement_required"),
    deviceId,
    destination: request.destination,
    occurredAt: request.occurredAt,
    ...(request.runId ? { sourceRunId: request.runId } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
  });
  const record = await store.read((tx) => tx.get("memory-fact", id));
  if (!record) throw new Error("fact_not_stored");
  return record;
}

async function writeLocal(
  ports: LocalDomainToolPorts,
  request: DomainToolRequest,
): Promise<DomainToolResult> {
  const store = storeOf(ports);
  const deviceId = deviceIdOf(ports);
  const record = request.tool === "project-create"
    ? await writeProject(store, request, deviceId)
    : request.tool === "ticket-create"
      ? await writeTicket(store, request, deviceId)
      : await writeFact(store, request, deviceId);
  return { kind: "local", tool: request.tool, id: record.id, record };
}

export function installLocalDomainTools(
  ctx: object,
  ports: LocalDomainToolPorts = {},
): InstalledLocalDomainTools {
  const existing = INSTALLED.get(ctx);
  if (existing) return existing;
  const installed: InstalledLocalDomainTools = {
    async execute(request) {
      if (!isLocalDomainTool(request.tool)) return REFUSED_NOT_LOCAL;
      if (ports.policyAllows === true && ports.platformTool) {
        const value = await ports.platformTool(request);
        return { kind: "platform", tool: request.tool, value };
      }
      return writeLocal(ports, request);
    },
  };
  INSTALLED.set(ctx, installed);
  return installed;
}
