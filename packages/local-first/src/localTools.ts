/**
 * Local domain tools (G06).
 *
 * When platform policy denies a capability, the local adapter is the tool.
 * It is chosen before any platform call, not after one fails.
 * executeDomainTool then writes the injected local store — a project, a
 * ticket, or a note — and returns that local result. The store's create
 * journal event is the only sync handoff. This module does not import a
 * network client, does not enqueue an MCP call, and does not call a platform
 * tool when policy denies the capability.
 */

import { createFactStore } from './factProvenance.js';
import { createLocalWork } from './localWork.js';
import type { EntityDestination, LocalRecord } from './records.js';
import type { LocalFirstStore } from './store.js';

export const LOCAL_DOMAIN_TOOLS = ['project-create', 'ticket-create', 'memory-recall'] as const;

export type LocalDomainTool = (typeof LOCAL_DOMAIN_TOOLS)[number];

export type DomainToolKind = 'local' | 'platform';

export interface ResolvedDomainTool {
  readonly kind: DomainToolKind;
  readonly tool: LocalDomainTool;
}

const KNOWN: ReadonlySet<string> = new Set(LOCAL_DOMAIN_TOOLS);

export const PLATFORM_DENIED_USE_LOCAL_TOOL = 'platform_denied_use_local_tool';

export const NOTE_TEXT_REQUIRED = 'note_text_required';

export const PLATFORM_TOOL_REQUIRED = 'platform_tool_required';

/** Provenance for a note recorded because the platform memory tool was denied. */
const LOCAL_NOTE_SOURCE = 'local-domain-tool';

export function isLocalDomainTool(value: string): value is LocalDomainTool {
  return KNOWN.has(value);
}

function requireTool(capability: string): LocalDomainTool {
  if (!isLocalDomainTool(capability)) {
    throw Object.assign(new Error('unknown_domain_tool'), { code: 'unknown_domain_tool' });
  }
  return capability;
}

function denied(): never {
  throw Object.assign(new Error(PLATFORM_DENIED_USE_LOCAL_TOOL), {
    code: PLATFORM_DENIED_USE_LOCAL_TOOL,
  });
}

/**
 * The tool the agent must call for a domain capability.
 * A denied policy returns the local adapter and never a platform tool.
 * Only an explicit allow selects the platform tool.
 */
export function localToolFor(capability: LocalDomainTool, policyAllows: boolean): ResolvedDomainTool {
  const tool = requireTool(capability);
  if (policyAllows === true) return Object.freeze({ kind: 'platform', tool });
  return Object.freeze({ kind: 'local', tool });
}

/**
 * Guard for a platform tool call. When policy denies the capability this
 * throws platform_denied_use_local_tool so the caller uses the local tool
 * instead of issuing the platform request.
 */
export function refusePlatformWhenDenied(capability: LocalDomainTool, policyAllows: boolean): void {
  requireTool(capability);
  if (policyAllows !== true) denied();
}

export type PlatformToolCaller = (
  tool: LocalDomainTool,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

interface DomainToolContext {
  readonly policyAllows: boolean;
  readonly store: LocalFirstStore;
  readonly deviceId: string;
  readonly occurredAt?: string;
  readonly destination?: EntityDestination;
  readonly platformTool?: PlatformToolCaller;
}

export type ExecuteDomainToolInput = DomainToolContext & (
  | {
      readonly capability: 'project-create';
      readonly name: string;
      readonly key?: string;
      readonly status?: string;
      readonly id?: string;
    }
  | {
      readonly capability: 'ticket-create';
      readonly projectId: string;
      readonly title: string;
      readonly description?: string;
      readonly status?: string;
      readonly priority?: string;
      readonly parentTicketId?: string;
      readonly id?: string;
    }
  | {
      readonly capability: 'memory-recall';
      /** The note text. Denied memory-recall records this locally. */
      readonly note: string;
      readonly key?: string;
      readonly id?: string;
      readonly sourceRunId?: string;
    }
);

export interface LocalDomainToolResult {
  readonly kind: 'local';
  readonly tool: LocalDomainTool;
  readonly id: string;
  readonly entityType: LocalRecord['entityType'];
  readonly record: LocalRecord;
}

export interface PlatformDomainToolResult {
  readonly kind: 'platform';
  readonly tool: LocalDomainTool;
  readonly result: unknown;
}

export type DomainToolExecution = LocalDomainToolResult | PlatformDomainToolResult;

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function requireText(value: string | undefined, code: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) fail(code);
  return trimmed;
}

function localResult(tool: LocalDomainTool, record: LocalRecord): LocalDomainToolResult {
  return Object.freeze({
    kind: 'local',
    tool,
    id: record.id,
    entityType: record.entityType,
    record,
  });
}

function domainArgs(input: ExecuteDomainToolInput): Readonly<Record<string, unknown>> {
  switch (input.capability) {
    case 'project-create':
      return Object.freeze({
        name: input.name,
        deviceId: input.deviceId,
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.id !== undefined ? { id: input.id } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
        ...(input.destination !== undefined ? { destination: input.destination } : {}),
      });
    case 'ticket-create':
      return Object.freeze({
        projectId: input.projectId,
        title: input.title,
        deviceId: input.deviceId,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.parentTicketId !== undefined ? { parentTicketId: input.parentTicketId } : {}),
        ...(input.id !== undefined ? { id: input.id } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
      });
    case 'memory-recall':
      return Object.freeze({
        note: input.note,
        deviceId: input.deviceId,
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.id !== undefined ? { id: input.id } : {}),
        ...(input.sourceRunId !== undefined ? { sourceRunId: input.sourceRunId } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
        ...(input.destination !== undefined ? { destination: input.destination } : {}),
      });
    default:
      fail('unknown_domain_tool');
  }
}

async function callPlatform(
  tool: LocalDomainTool,
  input: ExecuteDomainToolInput,
): Promise<PlatformDomainToolResult> {
  const caller = input.platformTool;
  if (!caller) fail(PLATFORM_TOOL_REQUIRED);
  const result = await caller(tool, domainArgs(input));
  return Object.freeze({ kind: 'platform', tool, result });
}

function noteId(id: string | undefined): string {
  if (id === undefined) return crypto.randomUUID();
  if (!id.trim()) fail('client_entity_id_must_be_stable_uuid');
  return id;
}

/**
 * Denied path only. Must not read or call `platformTool`. A validation
 * failure throws before the store is opened and never falls back to the platform.
 */
async function writeLocal(input: ExecuteDomainToolInput): Promise<LocalDomainToolResult> {
  switch (input.capability) {
    case 'project-create': {
      const record = await createLocalWork(input.store).createProject({
        name: input.name,
        deviceId: input.deviceId,
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.id !== undefined ? { id: input.id } : {}),
        ...(input.destination !== undefined ? { destination: input.destination } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
      });
      return localResult('project-create', record);
    }
    case 'ticket-create': {
      const record = await createLocalWork(input.store).createTicket({
        projectId: input.projectId,
        title: input.title,
        deviceId: input.deviceId,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.parentTicketId !== undefined ? { parentTicketId: input.parentTicketId } : {}),
        ...(input.id !== undefined ? { id: input.id } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
      });
      return localResult('ticket-create', record);
    }
    case 'memory-recall': {
      const statement = requireText(input.note, NOTE_TEXT_REQUIRED);
      const deviceId = requireText(input.deviceId, 'device_id_required');
      const id = noteId(input.id);
      const saved = await createFactStore(input.store).remember({
        id,
        key: input.key?.trim() || 'note',
        statement,
        deviceId,
        clientId: id,
        sourceRunId: input.sourceRunId?.trim() || LOCAL_NOTE_SOURCE,
        ...(input.destination !== undefined ? { destination: input.destination } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
      });
      const record = await input.store.read((tx) => tx.get('memory-fact', saved.id));
      if (!record) fail('note_not_recorded');
      return localResult('memory-recall', record);
    }
    default:
      fail('unknown_domain_tool');
  }
}

/**
 * Run a domain tool against policy. A denied policy writes the injected store
 * and returns the local record. It does not call `platformTool` and does not
 * fetch. Only an explicit allow delegates to `platformTool`, and that path
 * does not write the store.
 */
export async function executeDomainTool(input: ExecuteDomainToolInput): Promise<DomainToolExecution> {
  const resolved = localToolFor(input.capability, input.policyAllows);
  if (resolved.kind === 'platform') return callPlatform(resolved.tool, input);
  return writeLocal(input);
}
