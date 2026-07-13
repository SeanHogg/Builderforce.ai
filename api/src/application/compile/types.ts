/**
 * The `compile()` primitive — modality registry types (compile primitive Phase C2,
 * see `PRD-agent-compile-primitive.md`).
 *
 * The platform has several "define a need → run an agent" front doors. Each used to
 * compile a *different* representation of a need into a *different* artifact, with no
 * shared intermediate. `compile()` unifies them: one `Need` discriminated union (by
 * input modality), one registry of modality compilers, and one output — the
 * `AgentSpec` from `@builderforce/agent-tools`. A single need can stack modalities
 * (a process chart *with* a persona *with* a trained model is three adapters merging
 * into one spec via {@link mergeSpecs}).
 *
 * Dependencies the adapters need (an LLM completion for extraction, a knowledge
 * recall) are *injected* — the adapters stay pure and unit-testable, exactly like
 * `agentKnowledge.ts` takes a `SqlClient`. The presentation route wires the real
 * gateway + DB.
 */
import type { AgentExecParams, AgentSpec, AgentSurface, PolicyGate } from '@builderforce/agent-tools';
import type { CompiledStep, WorkflowDefinition } from '../../domain/workflowGraph';
import type { ToolResult } from '../tools/toolTypes';

/** The input modalities `compile()` knows how to lower. */
export type Modality = 'prose' | 'dataset' | 'process-chart' | 'persona' | 'diagnostic' | 'policy';

export interface ProseNeed {
  modality: 'prose';
  /** A plain-language description: "an agent that triages billing tickets from our docs". */
  text: string;
}

export interface DatasetNeed {
  modality: 'dataset';
  identity: { name: string; title?: string; bio?: string; skills?: string[] | string | null };
  /** A base model id or a `builderforce/workforce-<id>` trained ref. */
  modelRef?: string | null;
  /** Grounded context recalled from the agent's ingested proprietary docs (Phase C3). */
  recalledContext?: string;
}

export interface ProcessChartNeed {
  modality: 'process-chart';
  definition: WorkflowDefinition;
}

export interface PersonaNeed {
  modality: 'persona';
  /** A persona that has already been compiled to directives + exec levers. */
  directives?: string[];
  execParams?: AgentExecParams;
}

export interface DiagnosticNeed {
  modality: 'diagnostic';
  /** The findings of a `tool_run` (a maturity/diagnostic result). */
  findings: ToolResult;
  /** Optional subject (e.g. the project/process the diagnostic scored). */
  subject?: string;
}

export interface PolicyNeed {
  modality: 'policy';
  gates: PolicyGate[];
}

/** A need expressed in one modality. Stack several to merge into one spec. */
export type Need =
  | ProseNeed
  | DatasetNeed
  | ProcessChartNeed
  | PersonaNeed
  | DiagnosticNeed
  | PolicyNeed;

/**
 * An injected LLM completion. The prose + diagnostic adapters use it to extract
 * structure from free text; the route supplies the real gateway-backed call. Pure
 * adapters get a deterministic fake in tests. Returns the assistant message text.
 */
export type LlmComplete = (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>;

/** A grounded SOP/Process doc recalled for the diagnostic adapter. */
export interface KnowledgeRecallHit {
  id: string;
  title: string;
  docType: string;
  excerpt: string;
}

/**
 * An injected knowledge recall. The diagnostic adapter uses it to ground a
 * compiled improvement agent in the tenant's OWN published SOPs/processes rather
 * than generic advice. The route wires the real tenant-scoped DB read; pure
 * adapters get a deterministic fake (or omit it) in tests.
 */
export type RecallKnowledge = (query: string, topK?: number) => Promise<KnowledgeRecallHit[]>;

/** Dependencies injected into the modality adapters (kept minimal + faked in tests). */
export interface CompileDeps {
  llm?: LlmComplete;
  recallKnowledge?: RecallKnowledge;
}

export type { AgentSpec, AgentSurface, CompiledStep };
