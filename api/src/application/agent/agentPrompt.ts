/**
 * Shared agent persona/memory prompt builder + workforce-model resolver.
 *
 * One source of truth for turning a trained Workforce agent into an inference call,
 * used by THREE paths so they behave identically:
 *   • the dedicated chat endpoint   POST /api/ide/agents/:id/chat   (ideRoutes)
 *   • the pre-publish validate call  POST /api/ide/agents/validate   (ideRoutes)
 *   • the OpenAI-standard gateway    POST /v1/chat/completions       (llmRoutes)
 *
 * The OpenAI-standard path lets callers address a published model by the id
 * `builderforce/workforce-<id>` — the gateway expands it (like a `tenant_model:`
 * ref) into the agent's base model + persona/memory system directives, so the
 * stock OpenAI SDKs call a user's model verbatim.
 */

import { neon } from '@neondatabase/serverless';
import {
  agentMemorySignal,
  compilePsychometricProfile,
  lowerAgentSpec,
  type AgentExecParams,
  type AgentSpec,
  type LimbicPsychProfile,
} from '@builderforce/agent-tools';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { recallAgentKnowledge } from './agentKnowledge';

/** OpenAI-standard model id prefix for a published Workforce model. */
export const WORKFORCE_MODEL_REF_PREFIX = 'builderforce/workforce-';

export type AgentDescriptor = {
  name: string;
  title: string;
  bio: string;
  skills: string[] | string | null;
  r2_artifact_key?: string | null;
  mamba_state?: unknown;
  /**
   * Compiled persona directives (system-prompt lines). Optional — when a caller
   * has a psychometric/persona profile for the agent it passes the compiled
   * directives here and they render through the shared lowering.
   */
  personaDirectives?: string[];
  /** Compiled persona execution levers (think/reasoning/temperature). */
  execParams?: AgentExecParams;
  /** Grounded context recalled from the agent's memory (hybrid retrieval). */
  recalledContext?: string;
};

/** Build the canonical {@link AgentSpec} for an agent descriptor. */
function specFromDescriptor(d: AgentDescriptor): AgentSpec {
  return {
    identity: { name: d.name, title: d.title, bio: d.bio, skills: d.skills },
    persona:
      d.personaDirectives?.length || d.execParams
        ? { directives: d.personaDirectives, execParams: d.execParams }
        : undefined,
    memory: {
      recalledContext: d.recalledContext,
      stateSignal: agentMemorySignal(d.mamba_state),
    },
  };
}

export type AgentChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function resolveInferenceMode(d: AgentDescriptor): 'base' | 'lora' | 'hybrid' {
  const hasLora = !!d.r2_artifact_key;
  const hasMamba = !!d.mamba_state;
  return hasLora && hasMamba ? 'hybrid' : hasLora ? 'lora' : 'base';
}

/**
 * Builds the persona (+ persona directives + recalled/Mamba memory) system prompt
 * for an agent, via the shared {@link lowerAgentSpec} so every surface assembles
 * it identically (see `PRD-agent-compile-primitive.md`).
 */
export function buildAgentSystemPrompt(d: AgentDescriptor): string {
  return lowerAgentSpec(specFromDescriptor(d)).systemPrompt;
}

/**
 * Lower a descriptor to the full inference shape — system prompt **and** the
 * persona execution levers (think/reasoning/temperature) an engine should apply.
 * `buildAgentSystemPrompt` is the system-prompt-only convenience over this.
 */
export function buildAgentInference(d: AgentDescriptor): { systemPrompt: string; execParams: AgentExecParams } {
  const lowered = lowerAgentSpec(specFromDescriptor(d));
  return { systemPrompt: lowered.systemPrompt, execParams: lowered.execParams };
}

/** Prepends/merges the persona system prompt into a message list. */
export function applyAgentSystem(messages: AgentChatMessage[], system: string): AgentChatMessage[] {
  const existing = messages.find((m) => m.role === 'system');
  if (existing) return messages.map((m) => (m.role === 'system' ? { ...m, content: system + '\n\n' + m.content } : m));
  return [{ role: 'system', content: system }, ...messages];
}

export interface ResolvedWorkforceModel {
  /** The agent's base model — what actually dispatches to a vendor. */
  baseModel: string | null;
  /** Persona + memory system directives to prepend to the request. */
  directives: string;
  inferenceMode: 'base' | 'lora' | 'hybrid';
  /** Execution levers (think/reasoning/temperature) compiled from the agent's own
   *  psychometric personality, so a caller applies the persona's temperature/reasoning
   *  instead of a hardcoded default. Empty object when the agent has no profile. */
  execParams: AgentExecParams;
}

/** Parse the stored `ide_agents.psychometric` JSON into a profile, or `undefined`
 *  when absent/malformed/traitless (a fully neutral vector compiles to nothing). */
function parseAgentPsychometric(raw: unknown): LimbicPsychProfile | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const p = JSON.parse(raw) as LimbicPsychProfile;
    return p && typeof p === 'object' && p.vector ? p : undefined;
  } catch {
    return undefined;
  }
}

/** The published agent's base config — query-INDEPENDENT, so it is read-through
 *  cached by id (agents change rarely post-publish). Grounded recall is layered on
 *  per request (query-dependent) by {@link resolveWorkforceModel}. */
type WorkforceAgentBase = { baseModel: string | null; descriptor: AgentDescriptor; inferenceMode: 'base' | 'lora' | 'hybrid' };

async function loadWorkforceAgentBase(env: Env, agentId: string): Promise<WorkforceAgentBase | null> {
  return getOrSetCached(
    env,
    `workforce_model:resolve:${agentId}`,
    async (): Promise<WorkforceAgentBase | null> => {
      const rows = await neon(env.NEON_DATABASE_URL)`
        SELECT name, title, bio, skills, base_model, r2_artifact_key, mamba_state, inference_mode, psychometric
        FROM ide_agents WHERE id = ${agentId} LIMIT 1
      `;
      const a = rows[0] as Record<string, unknown> | undefined;
      if (!a) return null;
      // Compile the agent's OWN personality (ide_agents.psychometric) into persona
      // directives + exec levers so a Workforce agent executes UNDER its traits on every
      // path that resolves it (team-chat reply, dedicated chat, OpenAI-standard gateway) —
      // previously these descriptor fields existed but were never filled here, so the
      // personality was silently dropped. Compiled ONCE per cached agent base (no per-turn
      // recompute).
      const profile = parseAgentPsychometric(a.psychometric);
      const compiled = profile ? compilePsychometricProfile(profile) : undefined;
      const descriptor: AgentDescriptor = {
        name: String(a.name ?? ''),
        title: String(a.title ?? ''),
        bio: String(a.bio ?? ''),
        skills: (a.skills as string[] | string | null) ?? null,
        r2_artifact_key: (a.r2_artifact_key as string | null) ?? null,
        mamba_state: a.mamba_state,
        ...(compiled && compiled.directives.length ? { personaDirectives: compiled.directives } : {}),
        ...(compiled ? { execParams: compiled.params } : {}),
      };
      return {
        baseModel: (a.base_model as string | null) ?? null,
        descriptor,
        inferenceMode: (a.inference_mode as 'base' | 'lora' | 'hybrid') ?? resolveInferenceMode(descriptor),
      };
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/**
 * Expands a `builderforce/workforce-<id>` model ref into the agent's base model +
 * persona/memory directives. Returns null for a non-workforce ref or an unknown id.
 *
 * When a `query` is supplied (the caller's latest user message), the agent's ingested
 * proprietary knowledge is recalled (Phase C3, BM25 over `agent_knowledge_chunks`)
 * and folded into the directives through the SAME `lowerAgentSpec` lowering every
 * other surface uses — so a stock OpenAI-SDK caller addressing the model by id gets
 * the agent grounded on its own docs, exactly like the dedicated chat path. The agent
 * base is cached by id; recall is layered per request (chunk load is itself cached,
 * selection is pure) so the keyspace stays bounded.
 */
export async function resolveWorkforceModel(
  env: Env,
  ref: string | undefined | null,
  query?: string,
): Promise<ResolvedWorkforceModel | null> {
  if (!ref || !ref.startsWith(WORKFORCE_MODEL_REF_PREFIX)) return null;
  const agentId = ref.slice(WORKFORCE_MODEL_REF_PREFIX.length).trim();
  if (!agentId) return null;

  const base = await loadWorkforceAgentBase(env, agentId);
  if (!base) return null;

  const recalledContext = query?.trim()
    ? await recallAgentKnowledge(env, neon(env.NEON_DATABASE_URL), agentId, query)
    : '';

  // `buildAgentInference` lowers the descriptor to BOTH the system prompt (now carrying
  // the compiled persona directives) AND the persona exec levers — so a caller injects
  // the personality into the prompt AND applies its temperature/reasoning, from one lowering.
  const { systemPrompt, execParams } = buildAgentInference({
    ...base.descriptor,
    recalledContext: recalledContext || undefined,
  });

  return {
    baseModel: base.baseModel,
    directives: systemPrompt,
    inferenceMode: base.inferenceMode,
    execParams,
  };
}
