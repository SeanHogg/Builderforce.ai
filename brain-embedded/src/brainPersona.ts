/**
 * Brain personas — WHO the Brain answers as in a conversation.
 *
 * A composer's "Acting as" control offers three kinds of persona: the host's
 * default Brain, a built-in MODALITY persona (the Website builder, the mobile
 * coder, the Evermind teacher…), or an AGENT assigned to the Brain (scope='brain'
 * in the agent-assignment model). This module is the one definition of all three,
 * shared by the web app and the VS Code webview: the modality prompts live here
 * (the frontend's modality registry reads them from here too), and so do the choice
 * encoding, the agent join, and the two ways a host applies a persona.
 *
 * The two applications differ for a real reason. The web Brain has no environment
 * of its own to describe, so a persona REPLACES its system prompt
 * ({@link personaSystemPrompt}). The editor's base prompt describes the actual
 * workspace, file tools and repository — a Builder persona that talks about a live
 * browser Preview must not overwrite that — so the editor LAYERS the persona on top
 * ({@link personaOverlay}).
 */

import { loadAgentPoolVia, type PoolAgent, type PoolRequest } from './agentPool';

/** The project modalities that carry a Brain persona. */
export type PersonaModalityId = 'designer' | 'mobile' | 'webmobile' | 'evermind' | 'finetune' | 'voice';

/** Display order of the modality personas. */
export const PERSONA_MODALITY_IDS: readonly PersonaModalityId[] = ['designer', 'mobile', 'webmobile', 'evermind', 'finetune', 'voice'];

/** A modality persona: its glyph and the Brain prompt it runs under. */
export interface ModalityPersona {
  icon: string;
  prompt: string;
}

/**
 * Cross-modality strategy note appended to EVERY modality persona's prompt.
 * Whatever the project mode, strategy/goals are modeled as OKRs/Objectives in their
 * own tables (Portfolio ▸ OKRs) — NOT as tasks on the Kanban board — and the
 * assistant can create/link them via the platform tools.
 */
const STRATEGY_OKR_NOTE =
  'Strategy and goals live as OKRs/Objectives (Objectives + Key Results) in their own tables — not as tasks on the Kanban board. When the user talks about goals, outcomes, or strategy, you can create and link Objectives and Key Results, and promote an epic titled like "OKR …" into a real Objective, using the platform tools.';

/**
 * How a BUILDER persona delivers code: by writing it, never by handing it over.
 *
 * These personas used to say the opposite. The Website persona told the model to
 * "use a normal code block so the user can apply it" for the open file and to
 * fall back to path-tagged code blocks; the mobile personas offered code blocks
 * as the ONLY way to deliver a file. On 2026-10-03 a Studio build whose writes
 * were being cut off by the output ceiling ended exactly as those lines allowed:
 * the agent printed the CSS and asked the user to add it by hand, beside a live
 * Preview that only ever shows what was written.
 *
 * It names no tool on purpose (the prompt tool-name contract): this text is shared
 * by the web Builder, Studio and the editor, which advertise different file
 * tools, and a hand-typed name is right only until the next rename. The model
 * reads the real names off its own tool list.
 *
 * Exported because the build CAPABILITIES (`frontend/src/lib/brain/capabilities.ts`)
 * carry the same rule — one sentence of policy, one place it is written.
 */
export const FILE_DELIVERY_RULE = [
  'DELIVER CODE BY WRITING IT. Every file you produce goes into the project through your file tools: create new files, and change existing ones in place with the edit tool rather than rewriting them. The user is looking at a live Preview that shows only what you have written.',
  'NEVER hand the user code to copy, paste, add or apply by hand, and never answer with a code block in place of a file write — not for a stylesheet, not for "the rest of the file", not as a last resort after a failed write.',
  'When a write fails, read its error, fix the call and issue it again. When a file is too long for one call, write a smaller working first version and extend it with further edits.',
  'Only if you have NO tool that writes files at all, give each file as a code block whose language tag is its path (```src/App.jsx), and say that this surface cannot write files.',
].join('\n');

const BASE_PERSONAS: Record<PersonaModalityId, ModalityPersona> = {
  designer: {
    icon: '🌐',
    prompt: [
      'You are an expert AI coding assistant built into Builderforce.ai, a browser-based Builder. Help users generate and build websites and web apps.',
      'When the user describes an app to build, SCAFFOLD IT COMPLETELY in this turn: write every file the app needs to actually run — an index.html entry, a package.json with real dependencies and a `build` script, and all of the src/ components — so the live Preview renders a working app immediately, not a single snippet. Default to a Vite + React app unless the user asks for something else. List the project\'s files before writing, so you build on the starter rather than over it. When you have scaffolded the app, tell the user in one line what you built and that Preview is live and it is ready to Publish.',
      'Use markdown for your prose: headings, lists and bold.',
      FILE_DELIVERY_RULE,
    ].join('\n'),
  },
  mobile: {
    icon: '📱',
    prompt: [
      "You are an expert mobile app developer operating Builderforce.ai's Canvas Builder. The user is building a MOBILE app and previews it in a phone-sized device simulator.",
      'The project is a React Native app rendered for the web through react-native-web, so it runs in the browser preview AND stays portable to Expo. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" — never use HTML elements like div, span or button, and never use CSS files or className.',
      'Style with StyleSheet.create and flexbox. Remember there is no hover: design for touch, keep tap targets at least 44 points, and respect safe areas at the top and bottom of the screen.',
      'Design for a narrow portrait viewport (roughly 390 x 850 points) first. Prefer native navigation patterns — tab bars, stack headers, bottom sheets — over desktop patterns like sidebars and hover menus.',
      FILE_DELIVERY_RULE,
    ].join('\n'),
  },
  webmobile: {
    icon: '🖥️',
    prompt: [
      "You are an expert full-stack app developer built into Builderforce.ai's browser Builder. The user is building ONE app that ships as BOTH a responsive web application AND a mobile app, from a single codebase.",
      'The project is a React app rendered through react-native-web, so the SAME source runs full-width as a website AND inside a phone-sized device simulator, and stays portable to Expo for native iOS/Android. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" — never use HTML elements like div, span or button, and never use CSS files or className.',
      'Style with StyleSheet.create and flexbox, and make layouts RESPONSIVE: use flex, percentage widths and useWindowDimensions to adapt between a wide desktop viewport and a narrow phone one. Keep tap targets at least 44 points and respect safe areas — there is no hover on mobile.',
      FILE_DELIVERY_RULE,
    ].join('\n'),
  },
  evermind: {
    icon: '🧠',
    prompt: [
      "You are assisting with growing an Evermind — Builderforce.ai's self-updating model that learns continuously (Write-Through Cognition) instead of being frozen after training.",
      'Help the user teach it: draft facts, skills, and examples to feed it, reason about what it has learned, and interpret its Knowledge Map (neocortex / hippocampus / limbic regions).',
      'This is NOT classic fine-tuning — the model updates in place as it learns. Keep guidance oriented around teaching and recall, not training runs or LoRA adapters.',
    ].join('\n'),
  },
  finetune: {
    icon: '🔧',
    prompt: [
      'You are assisting with building and fine-tuning a custom LLM inside Builderforce.ai. This is the classic pipeline: design a dataset, train a LoRA adapter in-browser (WebGPU), benchmark it, then publish and export it.',
      'Help the user draft instruction/response pairs, choose a base model and training hyperparameters, and reason about training runs and benchmark results.',
    ].join('\n'),
  },
  voice: {
    icon: '🎙',
    prompt: [
      "You are a voice director inside Builderforce.ai's Voice Studio.",
      'The user enrolls a reference sample to clone a voice (SSM/WebGPU acoustic model) and then synthesizes speech from typed text.',
      'Help them write natural, well-punctuated lines to synthesize, and advise on pacing, emphasis, and tone.',
    ].join('\n'),
  },
};

/** Every modality persona, its prompt carrying the shared strategy/OKR note. */
export const MODALITY_PERSONAS: Readonly<Record<PersonaModalityId, ModalityPersona>> = Object.fromEntries(
  PERSONA_MODALITY_IDS.map((id) => [id, { ...BASE_PERSONAS[id], prompt: `${BASE_PERSONAS[id].prompt}\n${STRATEGY_OKR_NOTE}` }]),
) as Record<PersonaModalityId, ModalityPersona>;

/** An agent assigned to the Brain, named and model-resolved from the tenant pool. */
export interface BrainPersonaAgent {
  kind: string;
  ref: string;
  name: string;
  /** The agent's own model, or null for the default. */
  baseModel?: string | null;
}

/**
 * A persona choice, encoded as one stable string so a host can hold it in a single
 * piece of state: `'default'`, `'modality:<id>'`, or `'agent:<kind>:<ref>'`.
 */
export type BrainPersonaChoice = string;

export const DEFAULT_PERSONA: BrainPersonaChoice = 'default';

export function modalityPersonaChoice(id: string): BrainPersonaChoice {
  return `modality:${id}`;
}

export function agentPersonaChoice(agent: { kind: string; ref: string }): BrainPersonaChoice {
  return `agent:${agent.kind}:${agent.ref}`;
}

/** The modality a choice names, or null (unknown ids included). */
export function personaModalityOf(choice: BrainPersonaChoice): PersonaModalityId | null {
  if (!choice.startsWith('modality:')) return null;
  const id = choice.slice('modality:'.length);
  return (PERSONA_MODALITY_IDS as readonly string[]).includes(id) ? (id as PersonaModalityId) : null;
}

/** The assigned agent a choice names, or null when it names none of `agents`. */
export function personaAgentOf(choice: BrainPersonaChoice, agents: readonly BrainPersonaAgent[]): BrainPersonaAgent | null {
  return agents.find((a) => agentPersonaChoice(a) === choice) ?? null;
}

/** The framing that makes the Brain answer AS an assigned agent. */
export function agentPersonaPrompt(name: string): string {
  return `You are acting as the "${name}" agent for this workspace. Adopt its role, voice and duties when responding.`;
}

/**
 * The persona as a REPLACEMENT system prompt — for a host whose persona is the whole
 * prompt (the web Brain). `undefined` for the default persona (or a choice naming
 * nothing), so the host's own default applies.
 */
export function personaSystemPrompt(choice: BrainPersonaChoice, agents: readonly BrainPersonaAgent[]): string | undefined {
  const modality = personaModalityOf(choice);
  if (modality) return MODALITY_PERSONAS[modality].prompt;
  const agent = personaAgentOf(choice, agents);
  return agent ? agentPersonaPrompt(agent.name) : undefined;
}

/** Leads a modality persona layered over a host prompt that describes a real environment. */
const PERSONA_OVERLAY_PREFACE =
  'Persona for this conversation — adopt the domain focus below. Where it describes an environment, preview, or tools that differ from the ones described above, the ones above are what you actually have: use those.';

/**
 * The persona as an ADDITIVE directive — for a host that keeps its own base prompt
 * because that prompt describes the environment the run really executes in (the
 * editor's workspace, file tools and repository). `undefined` for the default persona.
 */
export function personaOverlay(choice: BrainPersonaChoice, agents: readonly BrainPersonaAgent[]): string | undefined {
  const modality = personaModalityOf(choice);
  if (modality) return `${PERSONA_OVERLAY_PREFACE}\n${MODALITY_PERSONAS[modality].prompt}`;
  const agent = personaAgentOf(choice, agents);
  return agent ? agentPersonaPrompt(agent.name) : undefined;
}

/**
 * The model an agent persona runs on — the agent's own `base_model` — or undefined
 * (default persona, modality persona, or an agent on the default model). A host
 * feeds it as a NON-strict preference: an explicit user pin still wins.
 */
export function personaModel(choice: BrainPersonaChoice, agents: readonly BrainPersonaAgent[]): string | undefined {
  return personaAgentOf(choice, agents)?.baseModel ?? undefined;
}

/** Join the Brain's agent assignments to the tenant pool — one entry per agent. */
export function brainPersonaAgents(
  assignments: ReadonlyArray<{ agentKind: string; agentRef: string }>,
  pool: readonly PoolAgent[],
): BrainPersonaAgent[] {
  const seen = new Set<string>();
  const out: BrainPersonaAgent[] = [];
  for (const a of assignments) {
    const key = agentPersonaChoice({ kind: a.agentKind, ref: a.agentRef });
    if (seen.has(key)) continue;
    seen.add(key);
    const pooled = pool.find((p) => p.kind === a.agentKind && p.ref === a.agentRef);
    out.push({ kind: a.agentKind, ref: a.agentRef, name: pooled?.name ?? `${a.agentKind}:${a.agentRef}`, baseModel: pooled?.baseModel ?? null });
  }
  return out;
}

/** The Brain's agent assignments (scope='brain'). */
export const BRAIN_AGENT_ASSIGNMENTS_PATH = '/api/agent-assignments?scope=brain';

/** Load the Brain's assigned agents through a host's transport. Degrades to []. */
export async function loadBrainPersonaAgentsVia(request: PoolRequest): Promise<BrainPersonaAgent[]> {
  const [assignments, pool] = await Promise.all([
    request<{ assignments?: Array<{ agentKind: string; agentRef: string }> }>(BRAIN_AGENT_ASSIGNMENTS_PATH)
      .then((r) => r?.assignments ?? [])
      .catch(() => [] as Array<{ agentKind: string; agentRef: string }>),
    loadAgentPoolVia(request).catch(() => [] as PoolAgent[]),
  ]);
  return brainPersonaAgents(assignments, pool);
}
