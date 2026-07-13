/**
 * `compile('prose')` — the plain-language front door. Turns "an agent that triages
 * billing tickets from our docs" into an {@link AgentSpec}: an LLM extracts the
 * agent's identity (name/title/bio/skills) from the description; the model is left
 * auto-routed so the gateway picks. This is the modality the platform was missing —
 * "any human defines a need in plain language" had no compiler until now.
 *
 * The LLM call is injected (`deps.llm`) so the adapter is pure + testable; the route
 * wires the real gateway. If extraction fails or no LLM is supplied, it degrades to
 * a usable spec built directly from the prose (never throws).
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import type { CompileDeps, ProseNeed } from './types';

const SYSTEM = `You turn a plain-language description of a desired AI agent into a compact JSON spec.
Return ONLY minified JSON, no prose, with this exact shape:
{"name":string,"title":string,"bio":string,"skills":string[]}
- name: a short human name for the agent (e.g. "Billing Triage Agent").
- title: a one-line role (e.g. "Customer-support triage specialist").
- bio: 1-2 sentences describing what it does and how it behaves.
- skills: 3-6 concrete capabilities as short noun phrases.`;

interface Extracted {
  name?: unknown;
  title?: unknown;
  bio?: unknown;
  skills?: unknown;
}

/** Defensive: pull the first JSON object out of an LLM reply (handles code fences). */
function parseExtracted(raw: string): Extracted | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Extracted;
  } catch {
    return null;
  }
}

/** Fallback identity when there is no LLM or extraction fails — never throws. */
function fallbackSpec(text: string): AgentSpec {
  const trimmed = text.trim();
  return {
    identity: {
      name: 'Custom Agent',
      title: 'Agent compiled from a plain-language need',
      bio: trimmed.slice(0, 280),
    },
    model: { ref: null, autoRoute: true },
    surfaces: ['cloud-durable', 'ide', 'workflow-node'],
  };
}

export async function compileFromProse(need: ProseNeed, deps: CompileDeps = {}): Promise<AgentSpec> {
  const text = need.text?.trim() ?? '';
  if (!text) return fallbackSpec('');
  if (!deps.llm) return fallbackSpec(text);

  let extracted: Extracted | null = null;
  try {
    const reply = await deps.llm([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text },
    ]);
    extracted = parseExtracted(reply);
  } catch {
    extracted = null;
  }
  if (!extracted) return fallbackSpec(text);

  const skills = Array.isArray(extracted.skills)
    ? extracted.skills.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : undefined;

  return {
    identity: {
      name: (typeof extracted.name === 'string' && extracted.name.trim()) || 'Custom Agent',
      title: typeof extracted.title === 'string' ? extracted.title : undefined,
      bio: (typeof extracted.bio === 'string' && extracted.bio.trim()) || text.slice(0, 280),
      ...(skills && skills.length ? { skills } : {}),
    },
    model: { ref: null, autoRoute: true },
    surfaces: ['cloud-durable', 'ide', 'workflow-node'],
  };
}
