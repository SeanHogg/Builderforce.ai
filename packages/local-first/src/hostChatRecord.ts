/**
 * Local system of record for a host chat (G03).
 *
 * The caller passes the store. Each append puts a local record in that store:
 * a chat, and the turn, run, step, or approval that belongs to it. Lineage is
 * on the record. Closing a panel does not drop them, because a new store loaded
 * from an export of this one still lists the same chat.
 *
 * Synchronization is a separate queue. This module does not append a journal
 * event, acknowledge one, or call the network.
 *
 * G10: `ensureChat` is the one place a chat is created here, and it resolves
 * the caller's destination explicitly, so a chat opened offline stores
 * `UNBOUND_DESTINATION` rather than an absent field. Every turn, run, step,
 * and approval then copies that snapshot (G11) — including the unbound one,
 * which is why an offline chat's run is explicitly unbound too.
 */

import type { EntityDestination, LocalEntityType, LocalRecord } from './records.js';
import { resolveCreateDestination } from './creationDestination.js';
import { newLocalRecord, type LocalFirstStore, type LocalFirstTransaction } from './store.js';

export interface HostLineage {
  chatId: string;
  turnId?: string;
  runId?: string;
  stepId?: string;
  parentId?: string;
}

export interface HostChatValue {
  title?: string;
  lineage: HostLineage;
}

export interface HostTurnValue {
  chatId: string;
  role: string;
  content: string;
  seq: number;
  lineage: HostLineage;
}

export interface HostRunValue {
  chatId: string;
  turnId?: string;
  parentRunId?: string;
  status: 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'interrupted';
  seq: number;
  lineage: HostLineage;
}

export interface HostStepValue {
  chatId: string;
  runId: string;
  name: string;
  kind?: string;
  seq: number;
  lineage: HostLineage;
}

export interface HostApprovalValue {
  chatId: string;
  runId?: string;
  stepId?: string;
  decision: string;
  subject?: string;
  seq: number;
  lineage: HostLineage;
}

interface Owned {
  chatId: string;
  seq?: number;
  lineage?: HostLineage;
}

export interface AppendHostTurnInput {
  chatId: string;
  id?: string;
  role: string;
  content?: string;
  deviceId: string;
  occurredAt?: string;
  destination?: EntityDestination;
  title?: string;
  parentTurnId?: string;
}

export interface AppendHostRunInput {
  chatId: string;
  id?: string;
  turnId?: string;
  parentRunId?: string;
  status?: HostRunValue['status'];
  deviceId: string;
  occurredAt?: string;
  destination?: EntityDestination;
  title?: string;
}

export interface AppendHostStepInput {
  chatId: string;
  id?: string;
  runId: string;
  name: string;
  kind?: string;
  deviceId: string;
  occurredAt?: string;
  destination?: EntityDestination;
}

export interface AppendHostApprovalInput {
  chatId: string;
  id?: string;
  runId?: string;
  stepId?: string;
  decision: string;
  subject?: string;
  deviceId: string;
  occurredAt?: string;
  destination?: EntityDestination;
}

export interface HostChatListing {
  readonly chatId: string;
  readonly chat: LocalRecord<HostChatValue> | undefined;
  readonly turns: readonly LocalRecord<HostTurnValue>[];
  readonly runs: readonly LocalRecord<HostRunValue>[];
  readonly steps: readonly LocalRecord<HostStepValue>[];
  readonly approvals: readonly LocalRecord<HostApprovalValue>[];
  /** Chat, turns, runs, steps, and approvals, in lineage order. */
  readonly records: readonly LocalRecord[];
}

export interface HostChatLog {
  appendTurn(input: AppendHostTurnInput): Promise<LocalRecord<HostTurnValue>>;
  appendRun(input: AppendHostRunInput): Promise<LocalRecord<HostRunValue>>;
  appendStep(input: AppendHostStepInput): Promise<LocalRecord<HostStepValue>>;
  appendApproval(input: AppendHostApprovalInput): Promise<LocalRecord<HostApprovalValue>>;
  list(chatId: string): Promise<HostChatListing>;
}

function requireText(value: string | undefined, code: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function entityId(id: string | undefined): string {
  if (id === undefined) return crypto.randomUUID();
  if (!id.trim()) throw new Error('client_entity_id_must_be_stable_uuid');
  return id;
}

function lineageOf(record: LocalRecord<Owned>): string | undefined {
  return record.payload.lineage?.chatId ?? record.payload.chatId;
}

function bySeq(a: LocalRecord<Owned>, b: LocalRecord<Owned>): number {
  const seq = (a.payload.seq ?? 0) - (b.payload.seq ?? 0);
  if (seq !== 0) return seq;
  const at = a.occurredAt.localeCompare(b.occurredAt);
  if (at !== 0) return at;
  return a.id.localeCompare(b.id);
}

async function nextSeq(tx: LocalFirstTransaction, entityType: LocalEntityType, chatId: string): Promise<number> {
  const rows = await tx.list<Owned>(entityType);
  return rows.filter((row) => !row.deletedAt && lineageOf(row) === chatId).length + 1;
}

async function requireOwned<T extends Owned>(
  tx: LocalFirstTransaction,
  entityType: LocalEntityType,
  id: string,
  chatId: string,
  code: string,
): Promise<LocalRecord<T>> {
  const record = await tx.get<T>(entityType, id);
  if (!record || record.deletedAt || lineageOf(record) !== chatId) {
    throw new Error(code);
  }
  return record;
}

async function requireFresh(tx: LocalFirstTransaction, entityType: LocalEntityType, id: string): Promise<void> {
  const existing = await tx.get(entityType, id);
  if (existing && !existing.deletedAt) throw new Error('client_entity_id_already_recorded');
}

async function ensureChat(
  tx: LocalFirstTransaction,
  input: {
    chatId: string;
    deviceId: string;
    occurredAt?: string;
    destination?: EntityDestination;
    title?: string;
  },
): Promise<LocalRecord<HostChatValue>> {
  const existing = await tx.get<HostChatValue>('chat', input.chatId);
  if (existing && !existing.deletedAt) return existing;
  const title = input.title?.trim();
  const record = newLocalRecord<HostChatValue>({
    id: input.chatId,
    entityType: 'chat',
    payload: {
      ...(title ? { title } : {}),
      lineage: { chatId: input.chatId },
    },
    deviceId: input.deviceId,
    destination: resolveCreateDestination(input.destination),
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
  });
  await tx.put(record);
  return record;
}

/**
 * A turn, run, step, or approval never re-binds its chat's destination
 * snapshot (G11). The destination a caller passes is used only by the call
 * that creates the chat, here, inside {@link ensureChat}.
 */
function chatDestination(chat: LocalRecord<HostChatValue>): EntityDestination {
  return resolveCreateDestination(chat.destination);
}

export function createHostChatLog(store: LocalFirstStore): HostChatLog {
  return {
    async appendTurn(input: AppendHostTurnInput): Promise<LocalRecord<HostTurnValue>> {
      const chatId = requireText(input.chatId, 'chat_id_required');
      const deviceId = requireText(input.deviceId, 'device_id_required');
      const role = requireText(input.role, 'turn_role_required');
      const id = entityId(input.id);
      const parentTurnId = input.parentTurnId?.trim() || undefined;
      return store.transact(async (tx) => {
        if (parentTurnId) await requireOwned<HostTurnValue>(tx, 'message', parentTurnId, chatId, 'turn_not_found');
        await requireFresh(tx, 'message', id);
        const chat = await ensureChat(tx, {
          chatId,
          deviceId,
          occurredAt: input.occurredAt,
          destination: input.destination,
          title: input.title,
        });
        const record = newLocalRecord<HostTurnValue>({
          id,
          entityType: 'message',
          payload: {
            chatId,
            role,
            content: input.content ?? '',
            seq: await nextSeq(tx, 'message', chatId),
            lineage: {
              chatId,
              ...(parentTurnId ? { parentId: parentTurnId, turnId: parentTurnId } : {}),
            },
          },
          deviceId,
          destination: chatDestination(chat),
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        });
        await tx.put(record);
        return record;
      });
    },

    async appendRun(input: AppendHostRunInput): Promise<LocalRecord<HostRunValue>> {
      const chatId = requireText(input.chatId, 'chat_id_required');
      const deviceId = requireText(input.deviceId, 'device_id_required');
      const id = entityId(input.id);
      const turnId = input.turnId?.trim() || undefined;
      const parentRunId = input.parentRunId?.trim() || undefined;
      const status = input.status ?? 'queued';
      return store.transact(async (tx) => {
        if (turnId) await requireOwned<HostTurnValue>(tx, 'message', turnId, chatId, 'turn_not_found');
        if (parentRunId) await requireOwned<HostRunValue>(tx, 'execution', parentRunId, chatId, 'run_not_found');
        await requireFresh(tx, 'execution', id);
        const chat = await ensureChat(tx, {
          chatId,
          deviceId,
          occurredAt: input.occurredAt,
          destination: input.destination,
          title: input.title,
        });
        const record = newLocalRecord<HostRunValue>({
          id,
          entityType: 'execution',
          payload: {
            chatId,
            status,
            seq: await nextSeq(tx, 'execution', chatId),
            ...(turnId ? { turnId } : {}),
            ...(parentRunId ? { parentRunId } : {}),
            lineage: {
              chatId,
              ...(turnId ? { turnId } : {}),
              ...(parentRunId || turnId ? { parentId: parentRunId ?? turnId } : {}),
            },
          },
          deviceId,
          destination: chatDestination(chat),
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        });
        await tx.put(record);
        return record;
      });
    },

    async appendStep(input: AppendHostStepInput): Promise<LocalRecord<HostStepValue>> {
      const chatId = requireText(input.chatId, 'chat_id_required');
      const deviceId = requireText(input.deviceId, 'device_id_required');
      const runId = requireText(input.runId, 'run_not_found');
      const name = requireText(input.name, 'step_name_required');
      const id = entityId(input.id);
      const kind = input.kind?.trim() || undefined;
      return store.transact(async (tx) => {
        const run = await requireOwned<HostRunValue>(tx, 'execution', runId, chatId, 'run_not_found');
        await requireFresh(tx, 'step', id);
        const chat = await ensureChat(tx, {
          chatId,
          deviceId,
          occurredAt: input.occurredAt,
          destination: input.destination,
        });
        const record = newLocalRecord<HostStepValue>({
          id,
          entityType: 'step',
          payload: {
            chatId,
            runId,
            name,
            seq: await nextSeq(tx, 'step', chatId),
            ...(kind ? { kind } : {}),
            lineage: {
              chatId,
              runId,
              parentId: runId,
              ...(run.payload.turnId ? { turnId: run.payload.turnId } : {}),
            },
          },
          deviceId,
          destination: chatDestination(chat),
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        });
        await tx.put(record);
        return record;
      });
    },

    async appendApproval(input: AppendHostApprovalInput): Promise<LocalRecord<HostApprovalValue>> {
      const chatId = requireText(input.chatId, 'chat_id_required');
      const deviceId = requireText(input.deviceId, 'device_id_required');
      const decision = requireText(input.decision, 'approval_decision_required');
      const runId = input.runId?.trim() || undefined;
      const stepId = input.stepId?.trim() || undefined;
      if (!runId && !stepId) throw new Error('approval_parent_required');
      const id = entityId(input.id);
      const subject = input.subject?.trim() || undefined;
      return store.transact(async (tx) => {
        if (runId) await requireOwned<HostRunValue>(tx, 'execution', runId, chatId, 'run_not_found');
        const step = stepId
          ? await requireOwned<HostStepValue>(tx, 'step', stepId, chatId, 'step_not_found')
          : undefined;
        if (step && runId && step.payload.runId !== runId) throw new Error('step_not_found');
        await requireFresh(tx, 'approval', id);
        const chat = await ensureChat(tx, {
          chatId,
          deviceId,
          occurredAt: input.occurredAt,
          destination: input.destination,
        });
        const linkedRunId = runId ?? step?.payload.runId;
        const record = newLocalRecord<HostApprovalValue>({
          id,
          entityType: 'approval',
          payload: {
            chatId,
            decision,
            seq: await nextSeq(tx, 'approval', chatId),
            ...(linkedRunId ? { runId: linkedRunId } : {}),
            ...(stepId ? { stepId } : {}),
            ...(subject ? { subject } : {}),
            lineage: {
              chatId,
              ...(linkedRunId ? { runId: linkedRunId } : {}),
              ...(stepId ? { stepId } : {}),
              parentId: stepId ?? linkedRunId ?? chatId,
            },
          },
          deviceId,
          destination: chatDestination(chat),
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        });
        await tx.put(record);
        return record;
      });
    },

    async list(chatId: string): Promise<HostChatListing> {
      const id = requireText(chatId, 'chat_id_required');
      return store.read(async (tx) => {
        const chat = await tx.get<HostChatValue>('chat', id);
        const owned = <T extends Owned>(rows: LocalRecord<T>[]): LocalRecord<T>[] =>
          rows.filter((row) => !row.deletedAt && lineageOf(row) === id).sort(bySeq);
        const turns = owned(await tx.list<HostTurnValue>('message'));
        const runs = owned(await tx.list<HostRunValue>('execution'));
        const steps = owned(await tx.list<HostStepValue>('step'));
        const approvals = owned(await tx.list<HostApprovalValue>('approval'));
        const visibleChat = chat && !chat.deletedAt ? chat : undefined;
        return {
          chatId: id,
          chat: visibleChat,
          turns,
          runs,
          steps,
          approvals,
          records: [
            ...(visibleChat ? [visibleChat] : []),
            ...turns,
            ...runs,
            ...steps,
            ...approvals,
          ],
        };
      });
    },
  };
}
