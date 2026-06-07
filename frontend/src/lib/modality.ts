/**
 * Project modality — the "mode" the IDE is operating in for a single project.
 *
 * One project, many modalities. A project named "BuilderForce Agents" is built across:
 *   - designer : the default app/agent builder (Preview + Code + WebContainer)
 *   - video    : client-side AI video generation (WebGPU/WebNN diffusion)
 *   - llm      : build + train a custom model whose output feeds the others
 *
 * Adding a modality = one entry here. The IDE switcher, the Brain's system
 * prompt, and the center panel all read from this single registry — no
 * branching scattered across components.
 */

export type ProjectModality = 'designer' | 'video' | 'llm';

/** Right-panel tab ids the IDE can surface. Each modality picks the relevant subset. */
export type RightTab = 'files' | 'train' | 'publish' | 'state';

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
  /** Whether the green "Run" button applies (npm install + Vite dev server).
   *  Video drives generation from its own panel; LLM has its own training flow. */
  showRunButton: boolean;
}

/** Labels for the right-panel tabs — single source so the IDE doesn't inline them. */
export const RIGHT_TAB_LABELS: Record<RightTab, string> = {
  files: '📁 Files',
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
    rightTabs: ['files', 'train', 'publish', 'state'],
    showRunButton: true,
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
  },
  {
    id: 'llm',
    label: 'LLM',
    icon: '🧠',
    tagline: 'Design datasets and train a custom model, then chat with it.',
    brainSystemPrompt:
      'You are assisting with building and training a custom LLM inside Builderforce.ai. Help the user design datasets, choose architectures, and reason about training runs.',
    brainPlaceholder: 'Ask about building or training your model…',
    brainEmptyState: 'Design your dataset and training run here — then fine-tune in the Train tab and ship from Publish.',
    rightTabs: ['files', 'train', 'publish', 'state'],
    showRunButton: false,
  },
];

export const DEFAULT_MODALITY: ProjectModality = 'designer';

/** Resolve a modality id (possibly stale/unknown) to its definition, defaulting to Designer. */
export function getModality(id: ProjectModality | string | null | undefined): ModalityDef {
  return MODALITIES.find((m) => m.id === id) ?? MODALITIES[0];
}
