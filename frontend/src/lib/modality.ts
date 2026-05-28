/**
 * Project modality — the "mode" the IDE is operating in for a single project.
 *
 * One project, many modalities. A project named "CoderClaw" is built across:
 *   - designer : the default app/agent builder (Preview + Code + WebContainer)
 *   - video    : client-side AI video generation (WebGPU/WebNN diffusion)
 *   - llm      : build + train a custom model whose output feeds the others
 *
 * Adding a modality = one entry here. The IDE switcher, the Brain's system
 * prompt, and the center panel all read from this single registry — no
 * branching scattered across components.
 */

export type ProjectModality = 'designer' | 'video' | 'llm';

export interface ModalityDef {
  id: ProjectModality;
  label: string;
  icon: string;
  /** Roadmap placeholder — switcher renders it disabled with a "soon" tag. */
  comingSoon?: boolean;
  /** Static system-prompt prefix injected into the Brain so the AI knows the
   *  active modality. Dynamic context (open file, etc.) is appended by AIChat. */
  brainSystemPrompt: string;
  /** Brain input placeholder for this modality. */
  brainPlaceholder: string;
  /** Brain empty-state hint for this modality. */
  brainEmptyState: string;
}

export const MODALITIES: ModalityDef[] = [
  {
    id: 'designer',
    label: 'Designer',
    icon: '🎨',
    brainSystemPrompt: [
      'You are an expert AI coding assistant built into Builderforce.ai, a browser-based IDE. Help users generate and build apps.',
      'Use markdown for your response: headings, lists, bold, and fenced code blocks.',
      'When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```package.json (then JSON content), ```src/index.js (then JS content), ```.gitignore (then content).',
      'When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it.',
    ].join('\n'),
    brainPlaceholder: 'Ask AI to build, explain, or refactor…',
    brainEmptyState: 'Open a file for context, or ask me to generate an app or create files.',
  },
  {
    id: 'video',
    label: 'Video',
    icon: '🎬',
    brainSystemPrompt: [
      "You are an expert video director and prompt engineer inside Builderforce.ai's AI Video Studio.",
      'The user generates short videos entirely client-side via diffusion (LCM / SD-Turbo) running on their own GPU, with Mamba SSM state carrying frame-to-frame coherence.',
      'Help them craft vivid, shot-level visual prompts covering: subject, action, environment, lighting, colour palette, camera angle, and a visual style descriptor (cinematic, anime, photoreal, etc.).',
      'When the user asks for a video, reply with a single refined prompt paragraph they can paste straight into the generator — no preamble, under 220 characters.',
    ].join('\n'),
    brainPlaceholder: 'Describe the video you want…',
    brainEmptyState: "Describe a scene and I'll craft a video prompt you can generate on the right.",
  },
  {
    id: 'llm',
    label: 'LLM',
    icon: '🧠',
    comingSoon: true,
    brainSystemPrompt:
      'You are assisting with building and training a custom LLM inside Builderforce.ai. Help the user design datasets, choose architectures, and reason about training runs.',
    brainPlaceholder: 'Ask about building or training your model…',
    brainEmptyState: 'LLM modality is coming soon — build and train models here.',
  },
];

export const DEFAULT_MODALITY: ProjectModality = 'designer';

/** Resolve a modality id (possibly stale/unknown) to its definition, defaulting to Designer. */
export function getModality(id: ProjectModality | string | null | undefined): ModalityDef {
  return MODALITIES.find((m) => m.id === id) ?? MODALITIES[0];
}
