/**
 * Local memory-fact provenance (G20).
 *
 * A fact is a versioned local record with its own provenance: a source run or
 * message id, a client id, occurredAt, and a content hash. It is a different
 * entity type from chat messages, so a chat sync cannot overwrite a fact and a
 * fact sync cannot overwrite a chat. A fact with missing provenance is refused.
 * This module does not fetch, and it does not call a platform API.
 */

import type { EntityDestination, JournalEvent, LocalRecord } from './records.js';
import { UNBOUND_DESTINATION } from './records.js';
import type { LocalFirstStore } from './store.js';
import { newLocalRecord } from './store.js';

export const FACT_SCHEMA_VERSION = 1;
export const FACT_ENTITY_TYPE = 'memory-fact' as const;

/**
 * Trust label on a fact's provenance. `client-reported` is what a client
 * claims; it is never an observation the platform made. It mirrors the server
 * constant of the same name in `api/src/domain/sync/syncProtocol.ts` (G25), so
 * a fact imported through sync carries the label that domain rule expects.
 */
export const CLIENT_REPORTED_EVIDENCE = 'client-reported' as const;

export type FactEvidence = typeof CLIENT_REPORTED_EVIDENCE | 'server-observed';

export interface FactValue {
  readonly key: string;
  readonly statement: string;
  readonly sourceRunId?: string;
  /** Message that produced the fact, when a run did not. Not the fact's identity. */
  readonly sourceMessageId?: string;
  /** Client entity id of the fact. Never a chat or message id. */
  readonly clientId?: string;
  readonly policyId?: string;
  /** When the fact occurred, distinct from the record's later update time. */
  readonly occurredAt?: string;
  /** Hash of key + statement. Chat sync must not be required to recompute it. */
  readonly contentHash?: string;
}

export interface FactProvenance {
  readonly deviceId: string;
  readonly actorId?: string;
  readonly source: 'local' | 'imported';
  readonly evidence?: FactEvidence;
  readonly policyVersion?: string;
  readonly recordedAt: string;
  readonly factVersion: number;
  /** Run that produced the fact, when one did. Never a chat id. */
  readonly sourceRunId?: string;
  /** Message that produced the fact, when a run did not. Never the fact's entity type. */
  readonly sourceMessageId?: string;
  /** Client entity id. A chat sync must not treat this as a message id. */
  readonly clientId: string;
  readonly occurredAt: string;
  readonly contentHash: string;
}

/** FNV-1a over the fact's content, matching the store's payload hash alphabet. */
export function factContentHash(content: Pick<FactValue, 'key' | 'statement'>): string {
  const text = JSON.stringify({ key: content.key, statement: content.statement });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export interface MemoryFact {
  readonly id: string;
  readonly key: string;
  readonly statement: string;
  readonly version: number;
  readonly destination: EntityDestination;
  readonly provenance: FactProvenance;
  readonly sourceRunId?: string;
  readonly policyId?: string;
  /** A fact is not a chat message. This field stays absent. */
  readonly chatId?: never;
}

export interface RememberFactInput {
  readonly id: string;
  readonly key: string;
  readonly statement: string;
  readonly deviceId: string;
  readonly actorId?: string;
  readonly destination?: EntityDestination;
  readonly occurredAt?: string;
  readonly sourceRunId?: string;
  readonly sourceMessageId?: string;
  /** Defaults to the fact id. A blank id is missing provenance, not a minted one. */
  readonly clientId?: string;
  readonly policyId?: string;
  readonly policyVersion?: string;
  readonly expectedVersion?: number;
}

function requireText(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function provenanceOf(record: LocalRecord<FactValue>): FactProvenance {
  const recorded = record.provenance;
  if (!recorded?.deviceId) throw provenanceError('missing_provenance');
  const evidence = factEvidenceOf(record);
  const sourceRunId = record.payload.sourceRunId;
  const sourceMessageId = record.payload.sourceMessageId;
  const projected: FactProvenance = {
    deviceId: recorded.deviceId,
    ...(recorded.actorId ? { actorId: recorded.actorId } : {}),
    source: recorded.source,
    ...(evidence ? { evidence } : {}),
    ...(recorded.policyVersion ? { policyVersion: recorded.policyVersion } : {}),
    recordedAt: record.updatedAt,
    factVersion: record.version,
    ...(sourceRunId ? { sourceRunId } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
    clientId: record.payload.clientId?.trim() || record.id,
    occurredAt: record.payload.occurredAt ?? record.occurredAt,
    contentHash: record.payload.contentHash ?? factContentHash(record.payload),
  };
  rejectMissingProvenance(projected);
  return projected;
}

function factPayload(input: {
  key: string;
  statement: string;
  occurredAt: string;
  clientId: string;
  sourceRunId?: string;
  sourceMessageId?: string;
  policyId?: string;
}): FactValue {
  return {
    key: input.key,
    statement: input.statement,
    clientId: input.clientId,
    occurredAt: input.occurredAt,
    contentHash: factContentHash({ key: input.key, statement: input.statement }),
    ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    ...(input.policyId ? { policyId: input.policyId } : {}),
  };
}

function rejectChatIdentity(input: object): void {
  if ('chatId' in input) {
    const chatId = (input as { chatId?: unknown }).chatId;
    const present = typeof chatId === 'string' ? chatId.trim().length > 0 : chatId != null;
    if (present) {
      throw Object.assign(new Error('fact_written_as_chat_message'), { code: 'FACT_WRITTEN_AS_CHAT_MESSAGE' });
    }
  }
  if ('entityType' in input) {
    const entityType = (input as { entityType?: unknown }).entityType;
    if (typeof entityType === 'string') assertFactNotWrittenAsChatMessage(entityType);
  }
}

/** Any record that can carry provenance, in the persisted or projected shape. */
export type ProvenanceCarrier =
  | Pick<LocalRecord<FactValue>, 'provenance'>
  | Pick<MemoryFact, 'provenance'>;

/** The evidence label on a record, read from either provenance shape. */
function factEvidenceOf(record: ProvenanceCarrier): FactEvidence | undefined {
  const evidence = record.provenance?.evidence;
  return evidence === CLIENT_REPORTED_EVIDENCE ? CLIENT_REPORTED_EVIDENCE : undefined;
}

function provenanceError(code: string): Error {
  return Object.assign(new Error(code), { code: code.toUpperCase() });
}

/**
 * A fact is not stored without saying where it came from. Provenance is a
 * source run or message id, a client id, occurredAt, and a content hash.
 * Missing any of those is refused. Nothing is defaulted in to fill the gap.
 */
export function rejectMissingProvenance(provenance: Partial<FactProvenance> | undefined | null): void {
  if (!provenance?.deviceId?.trim()) throw provenanceError('missing_provenance');
  if (!provenance.clientId?.trim()) throw provenanceError('missing_provenance');
  if (!provenance.occurredAt?.trim()) throw provenanceError('missing_provenance');
  if (!provenance.contentHash?.trim()) throw provenanceError('missing_provenance');
  if (!provenance.sourceRunId?.trim() && !provenance.sourceMessageId?.trim()) {
    throw provenanceError('missing_provenance');
  }
}

const CHAT_SYNC_ENTITY_TYPES = new Set<string>(['chat', 'message']);

export function isChatSyncEntityType(entityType: string): boolean {
  return CHAT_SYNC_ENTITY_TYPES.has(entityType);
}

export class FactChatIsolationError extends Error {
  readonly code = 'FACT_CHAT_ENTITY_ISOLATION' as const;
  readonly entityId: string;
  readonly existingType: string;
  readonly incomingType: string;
  constructor(entityId: string, existingType: string, incomingType: string) {
    super(`refusing to let ${incomingType} sync overwrite ${existingType} ${entityId}`);
    this.name = 'FactChatIsolationError';
    this.entityId = entityId;
    this.existingType = existingType;
    this.incomingType = incomingType;
  }
}

/**
 * Same client entity id, crossed types: a chat sync must not replace a fact,
 * and a fact sync must not replace a chat or message. Different ids are
 * independent. Same type is an ordinary update.
 */
export function assertSyncDoesNotCrossFactAndChat(
  existing: { readonly id: string; readonly entityType: string },
  incoming: { readonly id: string; readonly entityType: string },
): void {
  if (existing.id !== incoming.id) return;
  const existingFact = existing.entityType === FACT_ENTITY_TYPE;
  const incomingFact = incoming.entityType === FACT_ENTITY_TYPE;
  const existingChat = isChatSyncEntityType(existing.entityType);
  const incomingChat = isChatSyncEntityType(incoming.entityType);
  if ((existingFact && incomingChat) || (existingChat && incomingFact)) {
    throw new FactChatIsolationError(existing.id, existing.entityType, incoming.entityType);
  }
}

/**
 * Apply one sync record through the existing store. A cross of memory-fact
 * and chat/message on the same id is refused before put, so neither side is
 * overwritten. A fact payload still has to carry provenance.
 */
export async function applyLocalSync(store: LocalFirstStore, incoming: LocalRecord): Promise<void> {
  await store.transact(async (tx) => {
    const occupants = [
      await tx.get(FACT_ENTITY_TYPE, incoming.id),
      await tx.get('chat', incoming.id),
      await tx.get('message', incoming.id),
    ];
    for (const existing of occupants) {
      if (!existing || existing.entityType === incoming.entityType) continue;
      assertSyncDoesNotCrossFactAndChat(existing, incoming);
    }
    if (incoming.entityType === FACT_ENTITY_TYPE) {
      rejectMissingProvenance(provenanceOf(incoming as LocalRecord<FactValue>));
    }
    await tx.put(incoming);
  });
}

/**
 * Every locally written fact must say where it came from. A record with no
 * provenance is not a fact this store wrote, so it is refused rather than
 * repaired: an absent provenance means an unknown origin, and defaulting one in
 * would launder it into something that looks authoritative.
 */
export function assertProvenance(record: ProvenanceCarrier): void {
  if (!record.provenance?.deviceId?.trim()) throw provenanceError('missing_provenance');
}

/**
 * True when the fact is only what a client claimed. A client-reported fact is
 * a claim about itself, never a platform observation, so billing, audit and
 * the conflict rules must not treat it as one.
 */
export function isClientReported(record: ProvenanceCarrier): boolean {
  return factEvidenceOf(record) === CLIENT_REPORTED_EVIDENCE;
}

/**
 * May an incoming fact replace an existing one without a human deciding?
 *
 * Returning false is the default, and it is false in every case where the
 * promotion would be silent: the incoming fact is itself client-reported, or it
 * carries no actor to attribute the change to. Only a fact the platform
 * observed, naming who or what made it, may displace a client claim on its own.
 * A caller that needs an explicit override must take that decision itself.
 */
export function serverOverwritesClientReported(
  existing: ProvenanceCarrier,
  incoming: ProvenanceCarrier,
): boolean {
  if (!isClientReported(existing)) return true;
  if (isClientReported(incoming)) return false;
  return Boolean(incoming.provenance?.actorId?.trim());
}

export function toMemoryFact(record: LocalRecord<FactValue>): MemoryFact {
  if (record.entityType !== FACT_ENTITY_TYPE) throw new Error('not_a_memory_fact');
  return {
    id: record.id,
    key: record.payload.key,
    statement: record.payload.statement,
    version: record.version,
    destination: record.destination,
    provenance: provenanceOf(record),
    ...(record.payload.sourceRunId ? { sourceRunId: record.payload.sourceRunId } : {}),
    ...(record.payload.policyId ? { policyId: record.payload.policyId } : {}),
  };
}

/** Chat history is a different stream. A fact event must not ride on it. */
export function factJournalIsSeparate(event: Pick<JournalEvent, 'entityType'>): boolean {
  return event.entityType === FACT_ENTITY_TYPE;
}

/** A fact is never stored as a chat or message row. */
export function assertFactNotWrittenAsChatMessage(entityType: string): void {
  if (entityType === 'message' || entityType === 'chat') {
    throw Object.assign(new Error('fact_written_as_chat_message'), {
      code: 'FACT_WRITTEN_AS_CHAT_MESSAGE',
    });
  }
}

export class FactChatSyncError extends Error {
  readonly code = 'FACT_CHAT_SYNC_REFUSED' as const;
  readonly factId: string;
  /** The chat batch that was refused. Not copied onto the fact. */
  readonly refusedChatId: string;
  constructor(factId: string, refusedChatId: string) {
    super(`refusing to enqueue memory fact ${factId} onto chat sync batch ${refusedChatId}`);
    this.name = 'FactChatSyncError';
    this.factId = factId;
    this.refusedChatId = refusedChatId;
  }
}

export interface ChatSyncMessage {
  readonly id: string;
  readonly chatId: string;
  readonly entityType: 'message';
}

/** A chat-message sync batch. Facts are not members of one. */
export interface ChatSyncBatch {
  readonly chatId: string;
  readonly messages: ChatSyncMessage[];
}

/** The fact, disconnected from chat sync. No chatId. */
export interface DisconnectedFactRecord {
  readonly id: string;
  readonly entityType: typeof FACT_ENTITY_TYPE;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly contentHash: string;
  readonly sourceRunId?: string;
}

export interface FactChatSyncRefusal {
  readonly ok: false;
  readonly code: 'FACT_CHAT_SYNC_REFUSED';
  readonly error: FactChatSyncError;
  readonly disconnected: DisconnectedFactRecord;
}

/**
 * Refuse to enqueue a memory fact onto a chat sync batch. Returns a typed
 * error and a disconnected record. Does not append to `batch.messages`.
 */
export function refuseFactOnChatSync(fact: MemoryFact, batch: ChatSyncBatch): FactChatSyncRefusal {
  const disconnected: DisconnectedFactRecord = {
    id: fact.id,
    entityType: FACT_ENTITY_TYPE,
    deviceId: fact.provenance.deviceId,
    occurredAt: fact.provenance.occurredAt,
    contentHash: fact.provenance.contentHash,
    ...(fact.provenance.sourceRunId ? { sourceRunId: fact.provenance.sourceRunId } : {}),
  };
  return {
    ok: false,
    code: 'FACT_CHAT_SYNC_REFUSED',
    error: new FactChatSyncError(fact.id, batch.chatId),
    disconnected,
  };
}

export function createFactStore(store: LocalFirstStore) {
  return {
    async remember(input: RememberFactInput): Promise<MemoryFact> {
      rejectChatIdentity(input);
      const key = requireText(input.key, 'fact_key_required');
      const statement = requireText(input.statement, 'fact_statement_required');
      const deviceId = requireText(input.deviceId, 'fact_device_required');
      if (input.occurredAt !== undefined && !input.occurredAt.trim()) {
        throw provenanceError('missing_provenance');
      }
      if (!(input.clientId ?? input.id).trim()) throw provenanceError('missing_provenance');
      const at = input.occurredAt ?? new Date().toISOString();
      return store.transact(async (tx) => {
        const current = await tx.get<FactValue>(FACT_ENTITY_TYPE, input.id);
        if (input.expectedVersion !== undefined && current?.version !== input.expectedVersion) {
          throw Object.assign(new Error('fact_version_conflict'), { code: 'FACT_VERSION_CONFLICT' });
        }
        const chat = await tx.get('chat', input.id);
        const message = await tx.get('message', input.id);
        if (chat) assertSyncDoesNotCrossFactAndChat(chat, { id: input.id, entityType: FACT_ENTITY_TYPE });
        if (message) assertSyncDoesNotCrossFactAndChat(message, { id: input.id, entityType: FACT_ENTITY_TYPE });
        const destination = current?.destination ?? input.destination ?? UNBOUND_DESTINATION;
        const occurredAt = input.occurredAt ?? current?.payload.occurredAt ?? at;
        if (!occurredAt.trim()) throw provenanceError('missing_provenance');
        const sourceRunId = input.sourceRunId?.trim() || current?.payload.sourceRunId;
        const sourceMessageId = input.sourceMessageId?.trim() || current?.payload.sourceMessageId;
        if (!sourceRunId && !sourceMessageId) throw provenanceError('missing_provenance');
        const clientId = input.clientId?.trim() || current?.payload.clientId?.trim() || input.id.trim();
        if (!clientId) throw provenanceError('missing_provenance');
        const payload = factPayload({
          key,
          statement,
          occurredAt,
          clientId,
          sourceRunId,
          sourceMessageId,
          policyId: input.policyId ?? current?.payload.policyId,
        });
        const next: LocalRecord<FactValue> = current
          ? {
              ...current,
              version: current.version + 1,
              baseVersion: current.version,
              updatedAt: at,
              payload,
              provenance: {
                deviceId,
                source: 'local',
                ...(input.actorId ? { actorId: input.actorId } : {}),
                ...(input.policyVersion ? { policyVersion: input.policyVersion } : {}),
              },
            }
          : {
              ...newLocalRecord({
                id: input.id,
                entityType: FACT_ENTITY_TYPE,
                payload,
                deviceId,
                destination,
                occurredAt: at,
                schemaVersion: FACT_SCHEMA_VERSION,
              }),
              provenance: {
                deviceId,
                source: 'local' as const,
                ...(input.actorId ? { actorId: input.actorId } : {}),
                ...(input.policyVersion ? { policyVersion: input.policyVersion } : {}),
              },
            };
        assertFactNotWrittenAsChatMessage(next.entityType);
        if (next.entityType !== FACT_ENTITY_TYPE) {
          throw Object.assign(new Error('fact_written_as_chat_message'), { code: 'FACT_WRITTEN_AS_CHAT_MESSAGE' });
        }
        await tx.put(next, input.expectedVersion);
        const event = await tx.append({
          eventId: `fact:${input.id}:${next.version}`,
          clientEntityId: input.id,
          entityType: FACT_ENTITY_TYPE,
          operation: current ? 'update' : 'create',
          schemaVersion: FACT_SCHEMA_VERSION,
          occurredAt: at,
          ...(current ? { baseVersion: current.version } : {}),
          dependsOn: [],
          destination,
          payload: next.payload,
        });
        assertFactNotWrittenAsChatMessage(event.entityType);
        if (!factJournalIsSeparate(event)) throw new Error('fact_joined_chat_sync');
        const saved = toMemoryFact(next);
        if ('chatId' in saved) {
          throw Object.assign(new Error('fact_written_as_chat_message'), { code: 'FACT_WRITTEN_AS_CHAT_MESSAGE' });
        }
        return saved;
      });
    },

    async recall(id: string): Promise<MemoryFact | undefined> {
      const record = await store.read((tx) => tx.get<FactValue>(FACT_ENTITY_TYPE, id));
      return record && !record.deletedAt ? toMemoryFact(record) : undefined;
    },

    async list(): Promise<MemoryFact[]> {
      const records = await store.read((tx) => tx.list<FactValue>(FACT_ENTITY_TYPE));
      return records.filter((record) => !record.deletedAt).map(toMemoryFact);
    },

    async listForDevice(deviceId: string): Promise<MemoryFact[]> {
      const wanted = requireText(deviceId, 'fact_device_required');
      const facts = await this.list();
      return facts.filter((fact) => fact.provenance.deviceId === wanted);
    },

    applySync(incoming: LocalRecord): Promise<void> {
      return applyLocalSync(store, incoming);
    },
  };
}
