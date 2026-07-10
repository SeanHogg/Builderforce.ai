/**
 * Project modality — the "mode" the IDE is operating in for a single project.
 *
 * One project, many modalities. A project named "BuilderForce Agents" is built across:
 *   - designer : the default app/agent builder (Preview + Code + WebContainer)
 *   - video    : client-side AI video generation (WebGPU/WebNN diffusion)
 *   - evermind : grow a living, self-teaching Evermind model (teach + Knowledge Map)
 *   - finetune : design datasets and train a classic LoRA model, then ship it
 *
 * `evermind` and `finetune` were once a single combined `llm` modality; they are
 * now two distinct project types so the Studio no longer mixes "teach a living
 * model" with "train a LoRA adapter". Legacy `llm` projects resolve to `evermind`
 * (they were seeded with an Evermind recipe) — see `getModality`.
 *
 * Adding a modality = one entry here. The IDE switcher, the Brain's system
 * prompt, and the center panel all read from this single registry — no
 * branching scattered across components.
 */

export type ProjectModality = 'designer' | 'video' | 'evermind' | 'finetune' | 'voice';

/** Legacy modality id (the combined LLM Studio) → its replacement. */
const LEGACY_MODALITY_ALIASES: Record<string, ProjectModality> = { llm: 'evermind' };

/** Right-panel tab ids the IDE can surface. Each modality picks the relevant subset. */
export type RightTab = 'voice' | 'files' | 'agent' | 'train' | 'publish' | 'state';

export interface ModalityDef {
  id: ProjectModality;
  label: string;
  icon: string;
  /** One-line description of the project type, shown on the IDE dashboard's
   *  "new project" chooser cards. Single source so the launcher doesn't inline copy. */
  tagline: string;
  /** Roadmap placeholder — switcher renders it disabled with a "soon" tag. */
  comingSoon?: boolean;
  /** Static system-prompt prefix injected into the Brain so the AI knows the
   *  active modality. Dynamic context (open file, etc.) is appended by the Brain. */
  brainSystemPrompt: string;
  /** Brain input placeholder for this modality. */
  brainPlaceholder: string;
  /** Brain empty-state hint for this modality. */
  brainEmptyState: string;
  /** Right-panel tabs relevant to this modality, in display order. */
  rightTabs: RightTab[];
  /** Whether the green run button applies. Designer runs the WebContainer dev
   *  server; Voice generates speech. Video/LLM drive generation from their own
   *  panels, so they hide it. */
  showRunButton: boolean;
  /** Label for the green run button (e.g. "Run" for Designer, "Generate" for Voice). */
  runLabel: string;
  /** Whether the WebContainer Check + "Gate Run" controls apply — only the
   *  code-running Designer modality validates with type-check/lint/build. */
  showChecks: boolean;
}

/** Labels for the right-panel tabs — single source so the IDE doesn't inline them. */
export const RIGHT_TAB_LABELS: Record<RightTab, string> = {
  voice: '🎙 Voice',
  files: '📁 Files',
  agent: '🤖 Agent',
  train: '🧠 Train',
  publish: '🚀 Publish',
  state: '🔬 State',
};

export const MODALITIES: ModalityDef[] = [
  {
    id: 'designer',
    label: 'Designer',
    icon: '🎨',
    tagline: 'Generate and build apps with Preview, Code, and a live dev server.',
    brainSystemPrompt: [
      'You are an expert AI coding assistant built into Builderforce.ai, a browser-based IDE. Help users generate and build apps.',
      'Use markdown for your response: headings, lists, bold, and fenced code blocks.',
      'When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```package.json (then JSON content), ```src/index.js (then JS content), ```.gitignore (then content).',
      'When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it.',
    ].join('\n'),
    brainPlaceholder: 'Ask AI to build, explain, or refactor…',
    brainEmptyState: 'Open a file for context, or ask me to generate an app or create files.',
    rightTabs: ['files', 'agent', 'train', 'publish', 'state'],
    showRunButton: true,
    runLabel: 'Run',
    showChecks: true,
  },
  {
    id: 'video',
    label: 'Video',
    icon: '🎬',
    tagline: 'Generate short videos client-side on your own GPU via diffusion.',
    brainSystemPrompt: [
      "You are an expert video director and prompt engineer inside Builderforce.ai's AI Video Studio.",
      'The user generates short videos entirely client-side via diffusion (LCM / SD-Turbo) running on their own GPU, with Mamba SSM state carrying frame-to-frame coherence.',
      'Help them craft vivid, shot-level visual prompts covering: subject, action, environment, lighting, colour palette, camera angle, and a visual style descriptor (cinematic, anime, photoreal, etc.).',
      'When the user asks for a video, reply with a single refined prompt paragraph they can paste straight into the generator — no preamble, under 220 characters.',
    ].join('\n'),
    brainPlaceholder: 'Describe the video you want…',
    brainEmptyState: "Describe a scene and I'll craft a video prompt — use it in the generator on the left.",
    rightTabs: ['files', 'state'],
    showRunButton: false,
    runLabel: 'Run',
    showChecks: false,
  },
  {
    id: 'evermind',
    label: 'Evermind',
    icon: '🧠',
    tagline: 'Grow a living Evermind model that learns from every project — teach it and watch its Knowledge Map fill in.',
    brainSystemPrompt: [
      "You are assisting with growing an Evermind — Builderforce.ai's self-updating model that learns continuously (Write-Through Cognition) instead of being frozen after training.",
      'Help the user teach it: draft facts, skills, and examples to feed it, reason about what it has learned, and interpret its Knowledge Map (neocortex / hippocampus / limbic regions).',
      'This is NOT classic fine-tuning — the model updates in place as it learns. Keep guidance oriented around teaching and recall, not training runs or LoRA adapters.',
    ].join('\n'),
    brainPlaceholder: 'Teach your Evermind, or ask what it has learned…',
    brainEmptyState: 'Teach your Evermind in the console on the left — each lesson lands on the Knowledge Map. Ask me what to teach it next.',
    rightTabs: ['files', 'publish', 'state'],
    showRunButton: false,
    runLabel: 'Run',
    showChecks: false,
  },
  {
    id: 'finetune',
    label: 'Fine-tune',
    icon: '🔧',
    tagline: 'Design datasets and train a custom LoRA model, then benchmark, publish, and export it.',
    brainSystemPrompt: [
      'You are assisting with building and fine-tuning a custom LLM inside Builderforce.ai. This is the classic pipeline: design a dataset, train a LoRA adapter in-browser (WebGPU), benchmark it, then publish and export it.',
      'Help the user draft instruction/response pairs, choose a base model and training hyperparameters, and reason about training runs and benchmark results.',
    ].join('\n'),
    brainPlaceholder: 'Ask about datasets, training, or benchmarks…',
    brainEmptyState: 'Design your dataset and training run here — then fine-tune in the Train tab and ship from Publish.',
    rightTabs: ['files', 'train', 'publish', 'state'],
    showRunButton: false,
    runLabel: 'Run',
    showChecks: false,
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: '🎙',
    tagline: 'Clone and design a custom voice, then synthesize speech from it.',
    brainSystemPrompt: [
      "You are a voice director inside Builderforce.ai's Voice Studio.",
      'The user enrolls a reference sample to clone a voice (SSM/WebGPU acoustic model) and then synthesizes speech from typed text.',
      'Help them write natural, well-punctuated lines to synthesize, and advise on pacing, emphasis, and tone.',
    ].join('\n'),
    brainPlaceholder: 'Describe the voice or the lines to synthesize…',
    brainEmptyState: 'Write the lines to narrate (or ask me to), pick a voice in the panel, then press Generate.',
    rightTabs: ['voice', 'files', 'state'],
    showRunButton: true,
    runLabel: 'Generate',
    showChecks: false,
  },
];

export const DEFAULT_MODALITY: ProjectModality = 'designer';

/** Resolve a modality id (possibly stale/unknown/legacy) to its definition, defaulting
 *  to Designer. Legacy ids (e.g. the retired combined `llm`) map through the alias table. */
export function getModality(id: ProjectModality | string | null | undefined): ModalityDef {
  const resolved = (typeof id === 'string' && LEGACY_MODALITY_ALIASES[id]) || id;
  return MODALITIES.find((m) => m.id === resolved) ?? MODALITIES[0];
}
