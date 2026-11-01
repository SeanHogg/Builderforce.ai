/**
 * The differential parity harness (PRD 35 WS4, area D): the shapes it shares.
 *
 * One SCENARIO is a scripted conversation with the Brain - a fake model, fake host tools, the actions a person takes
 * mid-run (Stop, steer, confirm). It runs through the real `startRun` once per engine, on the production binding
 * (`driveRun` -> `runPrepared` for the agent, `runLoop` for the loop), and the harness records what every observer
 * saw. The record of one engine must equal the record of the other once ids and timestamps are normalised
 * (`normalise.ts`, the only place a difference is ever excused, each one named).
 */

import type { BrainRunRequest, RunEngineId } from '../../runStore/runTypes';
import type { StreamChatOptions, StreamChatResult, StreamHandlers } from '../../streamChatCompletion';
import type { StartOutcome } from '../../runStore/refusedStart';

/** One model request as the wire would carry it: every option the stream was handed, less the transport and the signal. */
export type WireCall = Omit<StreamChatOptions, 'transport' | 'signal'> & { aborted?: boolean; summary?: boolean };

/** What a scripted model turn is handed. */
export interface TurnInput {
  opts: Omit<StreamChatOptions, 'transport'>;
  handlers: StreamHandlers | undefined;
  /** 1-based number of this call among the scenario's model calls (summaries included). */
  call: number;
}

/** A scripted model turn: the result it returns, or a throw. */
export type ScriptedTurn = (input: TurnInput) => StreamChatResult | Promise<StreamChatResult>;

/** A host tool: what `runTool` answers for one tool name. */
export type HostTool = (args: unknown) => unknown | Promise<unknown>;

/** What a scenario drives. One instance per engine run. */
export interface ScenarioHost {
  readonly engine: RunEngineId;
  /** The run key every start uses unless it names another. */
  readonly key: number;
  /** The model's answer to any call the script has run out of (it decides from the request). */
  react(turn: ScriptedTurn): void;
  /** Rows already in the chat before the run (the host's saved history). Not part of the run's record. */
  preload(rows: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, key?: number): number[];
  /** Save the person's new message the way the send path does, and return its row id (`userTurnMessageId`). */
  saveUser(text: string, key?: number): number;
  /** The seed a host builds from the saved history (`transcriptSeedOf`): what a fresh page seeds a run with. */
  seedOf(key?: number): { seed: import('../../streamChatCompletion').ChatCompletionMessage[]; seedIds: number[] };
  /** Replace the model's script. The next model call takes the first turn. */
  script(turns: ScriptedTurn[], summary?: string | ((input: TurnInput) => string | Promise<string>)): void;
  /** The host's tools by name; any name not here fails the call. `confirm` names the tools `needsConfirm` holds for approval. */
  tools(impl: Record<string, HostTool>, confirm?: string[]): void;
  /** Start a run on `key`. `over` is merged over the scenario's default request. */
  start(over?: Partial<BrainRunRequest>, key?: number): Promise<StartOutcome>;
  /** Start a run and hand back its promise without awaiting it, for a scenario that acts mid-run. */
  begin(over?: Partial<BrainRunRequest>, key?: number): Promise<StartOutcome>;
  /** Forget the run store, as a page reload does. The host's persisted rows stay. */
  reload(): void;
  /** The messages the host has persisted so far (what a reload would seed from). */
  persistedMessages(): Array<{ id: number; chatId: number; role: string; content: string; metadata: string | null; seq: number; createdAt: string }>;
  /** Resolves when `ok` is true, polling the microtask/timer queue (a mid-run action waits for its moment). */
  until(ok: () => boolean, label: string): Promise<void>;
  /** Let queued microtasks and zero-delay timers settle. */
  settle(): Promise<void>;
}

/** A scenario: id, the rows of the rulings it proves, and what it does. */
export interface Scenario {
  /** Stable id, also the snapshot's file name. */
  id: string;
  /** The ruling rows (T1..T14, R1..R11, or a named area) this scenario proves. */
  rows: readonly string[];
  title: string;
  /** Trace labels the LOOP's record must contain: proof the scenario reached the behaviour it is named for. */
  loopShows?: readonly string[];
  run(host: ScenarioHost): Promise<void>;
}

/** What the host's own surfaces saw of a run. */
export interface HostFrame {
  running: boolean;
  error: string;
  errorAction: unknown;
  confirm: string | null;
  /** `phase[:label]#step` of the in-flight step. */
  activity: string | null;
}

/** The record one engine leaves for one scenario. */
export interface RunRecord {
  /** Every model request, in order. */
  wire: WireCall[];
  /** Every row the host persisted, in order. */
  persisted: Array<{ chatId: number; role: string; content: string; metadata: unknown; learned: boolean; eventKey?: string }>;
  /** The trace, for every run key the scenario used. */
  trace: Record<string, unknown[]>;
  /** What the host saw. */
  host: {
    /** Distinct consecutive frames of each run key, as the host's subscriber read them. */
    frames: Record<string, HostFrame[]>;
    /** The settled snapshot of each run key. */
    final: Record<string, unknown>;
    /** `onActivity` calls, per chat. */
    activityCalls: Record<string, number>;
    /** Every host tool call, in order. */
    toolCalls: Array<{ name: string; args: unknown }>;
    /** Every `needsConfirm` question the run asked. */
    confirmAsks: Array<{ name: string; args: unknown }>;
    /** What the cell keeps for the chat's next run: the working transcript, the fold memo, the anchors. */
    cell: Record<string, unknown>;
  };
  /** Usage the cell accrued. */
  usage: Record<string, unknown>;
  /** The outcome rows the ledger was told. */
  outcome: { reported: unknown[]; ended: unknown[]; avoided: unknown[] };
  /** The error a run threw (never, startRun settles it) or surfaced, per key. */
  error: Record<string, { message: string; action: unknown }>;
  /** The scenario itself failed to complete (a wait that never came true): a difference, never a skip. */
  scenarioError?: string;
}
