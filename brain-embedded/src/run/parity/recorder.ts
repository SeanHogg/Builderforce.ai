/**
 * What the parity harness observes of a run, gathered the way each of the Brain's real observers would:
 * the model transport (every request), the host's persistence (every row), the host's tool port, the
 * cell's subscribers (what a mounted view repaints on) and the ledger callbacks. One `Recorder` per
 * engine run; `toRecord` turns it into the comparable {@link RunRecord}.
 */

import type { BrainMessage } from '../../types';
import { isMidTurnMetadata } from '@builderforce/agent-loop';
import { EVERMIND_MIN_TEACH_CHARS } from '@seanhogg/builderforce-memory/evermind';
import { isStoppedTurn } from '../../stoppedTurn';
import { getCell } from '../../runStore/runCells';
import { getRunSnapshot, getRunTrace, subscribeRun } from '../../runStore/runControl';
import type { BrainRunPersistence } from '../../runStore/runTypes';
import type { HostFrame, RunRecord, WireCall } from './types';

const parse = (raw: string | undefined): unknown => {
  if (raw === undefined) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
};

/** A deep copy of what the stream was handed: the transcript arrays are mutated after the call returns. */
export function copyWire(opts: Record<string, unknown>): WireCall {
  const { signal: _signal, transport: _transport, ...rest } = opts;
  return JSON.parse(JSON.stringify(rest)) as WireCall;
}

export class Recorder {
  readonly wire: WireCall[] = [];
  readonly stored: BrainMessage[] = [];
  readonly persisted: RunRecord['persisted'] = [];
  readonly toolCalls: RunRecord['host']['toolCalls'] = [];
  readonly confirmAsks: RunRecord['host']['confirmAsks'] = [];
  readonly activityCalls: Record<string, number> = {};
  readonly reported: unknown[] = [];
  readonly ended: unknown[] = [];
  readonly avoided: unknown[] = [];
  readonly frames: Record<string, HostFrame[]> = {};
  readonly keys = new Set<number>();
  scenarioError: string | undefined;
  private readonly watched = new Set<unknown>();
  private nextId = 1000;

  /** The persistence port the host hands every run: it keeps the rows, so a reload can seed from them. */
  readonly persistence: BrainRunPersistence = {
    sendMessages: async (chatId, messages) => {
      const out: BrainMessage[] = [];
      for (const m of messages) {
        const id = this.nextId++;
        // The server teaches Evermind from an assistant turn unless it is mid-turn text, a stopped reply or too short
        // (`api` learn gate); the same rule here makes "this turn was learned" a recorded fact on each persisted row.
        const learned = m.role === 'assistant' && !isMidTurnMetadata(m.metadata) && !isStoppedTurn({ metadata: m.metadata ?? null }) && m.content.length >= EVERMIND_MIN_TEACH_CHARS;
        this.persisted.push({ chatId, role: m.role, content: m.content, metadata: parse(m.metadata), learned, ...(m.eventKey ? { eventKey: m.eventKey } : {}) });
        const row: BrainMessage = { id, role: m.role, content: m.content, metadata: m.metadata ?? null, seq: id, createdAt: new Date().toISOString(), ...(m.role === 'assistant' ? { evermindLearn: { learned, version: 3 } } : {}) };
        this.stored.push({ ...row, chatId } as BrainMessage);
        out.push(row);
      }
      return out;
    },
    getMessages: async (chatId) => this.stored.filter((m) => (m as BrainMessage & { chatId?: number }).chatId === chatId),
  };

  /** A row that exists before the run (saved history, the person's own message). */
  store(chatId: number, role: string, content: string): number {
    const id = this.nextId++;
    this.stored.push({ id, role, content, metadata: null, seq: id, createdAt: new Date().toISOString(), chatId } as BrainMessage);
    return id;
  }

  onActivity = (chatId: number): void => {
    this.activityCalls[String(chatId)] = (this.activityCalls[String(chatId)] ?? 0) + 1;
  };

  /** Watch a run key the way a mounted view does. Idempotent per cell, so a reload re-subscribes the new one. */
  watch(key: number): void {
    this.keys.add(key);
    const c = getCell(key);
    if (this.watched.has(c)) return;
    this.watched.add(c);
    const frames = (this.frames[String(key)] ??= []);
    subscribeRun(key, () => {
      const s = getRunSnapshot(key);
      const a = s.activity;
      const frame: HostFrame = {
        running: s.running,
        error: s.error,
        errorAction: s.errorAction,
        confirm: s.pendingConfirm?.name ?? null,
        activity: a ? `${a.phase}${a.label ? `:${a.label}` : ''}#${a.step}` : null,
      };
      if (JSON.stringify(frames.at(-1)) !== JSON.stringify(frame)) frames.push(frame);
    });
  }

  toRecord(): RunRecord {
    const final: Record<string, unknown> = {};
    const trace: Record<string, unknown[]> = {};
    const error: RunRecord['error'] = {};
    const cell: Record<string, unknown> = {};
    const usage: Record<string, unknown> = {};
    for (const key of this.keys) {
      const s = getRunSnapshot(key);
      const c = getCell(key);
      final[String(key)] = {
        running: s.running, streamingText: s.streamingText, error: s.error, errorAction: s.errorAction,
        pendingConfirm: s.pendingConfirm, messagesEpoch: s.messagesEpoch, hasTrace: s.hasTrace,
        appended: s.appended.map((m) => ({ role: m.role, content: m.content, metadata: parse(m.metadata ?? undefined), evermindLearn: m.evermindLearn })),
        activity: s.activity ? { phase: s.activity.phase, label: s.activity.label, detail: s.activity.detail, step: s.activity.step } : null,
        byoUnresolved: s.byoUnresolved, providerCap: s.providerCap, turn: s.turn,
      };
      trace[String(key)] = getRunTrace(key).map((e) => ({ ...e }));
      if (c.error !== '' || c.errorAction) error[String(key)] = { message: c.error, action: c.errorAction };
      usage[String(key)] = { tally: c.runUsage, codeModel: c.codeModel, lastServedModel: c.lastServedModel };
      cell[String(key)] = {
        transcript: c.transcript, compactMemo: c.compactMemo, transcriptAnchors: c.transcriptAnchors, unseenFromId: c.unseenFromId,
        codeChanged: c.codeChanged, touchedFiles: c.touchedFiles, ticketRecorded: c.ticketRecorded, deltaTicketId: c.deltaTicketId,
        priorResearch: c.priorResearch,
      };
    }
    return {
      wire: this.wire,
      persisted: this.persisted,
      trace,
      host: { frames: this.frames, final, activityCalls: this.activityCalls, toolCalls: this.toolCalls, confirmAsks: this.confirmAsks, cell },
      usage,
      outcome: { reported: this.reported, ended: this.ended, avoided: this.avoided },
      error,
      ...(this.scenarioError ? { scenarioError: this.scenarioError } : {}),
    };
  }
}
