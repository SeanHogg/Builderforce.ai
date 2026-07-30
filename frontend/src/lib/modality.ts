/**
 * Project modality — the "mode" the IDE is operating in for a single project.
 *
 * One project, many modalities. A project named "BuilderForce Agents" is built across:
 *   - designer : the default app/agent builder (Preview + Code + WebContainer)
 *   - mobile   : the same builder, framed for phones (device simulator + scan-to-phone)
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

export type ProjectModality = 'designer' | 'mobile' | 'webmobile' | 'video' | 'evermind' | 'finetune' | 'voice';

/** Legacy modality id (the combined LLM Studio) → its replacement. */
const LEGACY_MODALITY_ALIASES: Record<string, ProjectModality> = { llm: 'evermind' };

/** Right-panel tab ids the IDE can surface. Each modality picks the relevant subset. */
export type RightTab = 'voice' | 'files' | 'agent' | 'train' | 'publish' | 'state';

/**
 * Which component fills the IDE's centre pane. Naming the layout here (rather
 * than branching on the modality id inside the IDE) is what keeps "add a
 * modality = one entry in this registry" true — `mobile` reuses the Designer's
 * whole run/build pipeline and differs only by rendering `device` instead of
 * `code-preview`.
 */
export type CenterPanel = 'code-preview' | 'device' | 'video' | 'voice' | 'evermind' | 'finetune';

/** Which Publish panel the right rail shows: a hosted site, or a trained agent. */
export type PublishPanel = 'site' | 'agent';

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
  /** Brain empty-state hint for this modality. */
  /** Right-panel tabs relevant to this modality, in display order. */
  rightTabs: RightTab[];
  /** Whether the green run button applies. Designer runs the WebContainer dev
   *  server; Voice generates speech. Video/LLM drive generation from their own
   *  panels, so they hide it. */
  showRunButton: boolean;
  /** Label for the green run button (e.g. "Run" for Designer, "Generate" for Voice). */
  runLabel: string;
  /** Whether the WebContainer Check + "Gate Run" controls apply — only the
   *  code-running Designer/Mobile modalities validate with type-check/lint/build. */
  showChecks: boolean;
  /** Which component fills the centre pane. */
  center: CenterPanel;
  /** Whether the agent chat is docked into the left panel. When false the IDE
   *  uses the global floating Brain drawer instead. Chat-driven modalities dock. */
  dockBrain: boolean;
  /** Which Publish panel the right rail's Publish tab renders. */
  publishPanel: PublishPanel;
  /**
   * For a `code-preview` centre, also offer a phone-bezel preview toggle + the
   * scan-to-phone panel. Set on the combined Web + Mobile type so one project
   * builds and previews as BOTH a responsive web app and a handset app from a
   * single (react-native-web) codebase. `mobile`'s device centre already implies
   * this; here it augments the web preview rather than replacing it. */
  enableMobilePreview?: boolean;
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

/**
 * Cross-modality strategy note appended to EVERY modality's Brain system prompt.
 * Whatever the project mode, strategy/goals are modeled as OKRs/Objectives in
 * their own tables (Portfolio ▸ OKRs) — NOT as tasks on the Kanban board — and the
 * assistant can create/link them via the platform tools. Single source so no
 * modality prompt drifts on how goals are represented. See [[okr-objectives-vs-epics]].
 */
const STRATEGY_OKR_NOTE =
  'Strategy and goals live as OKRs/Objectives (Objectives + Key Results) in their own tables — not as tasks on the Kanban board. When the user talks about goals, outcomes, or strategy, you can create and link Objectives and Key Results, and promote an epic titled like "OKR …" into a real Objective, using the platform tools.';

const BASE_MODALITIES: ModalityDef[] = [
  {
    id: 'designer',
    label: 'Website',
    icon: '🌐',
    tagline: 'Generate and build a website or web app with Preview, Code, and a live dev server.',
    brainSystemPrompt: [
      'You are an expert AI coding assistant built into Builderforce.ai, a browser-based Builder. Help users generate and build websites and web apps.',
      'When the user describes an app to build, SCAFFOLD IT COMPLETELY in this turn: call the `create_file` tool for every file the app needs to actually run — an index.html entry, a package.json with real dependencies and a `build` script, and all of the src/ components — so the live Preview renders a working app immediately, not a single snippet. Default to a Vite + React app unless the user asks for something else. Prefer `create_file` over pasting code the user must apply by hand. When you have scaffolded the app, tell the user in one line what you built and that Preview is live and it is ready to Publish.',
      'Use markdown for your response: headings, lists, bold, and fenced code blocks.',
      'If the file tools are unavailable, fall back to suggesting files as a code block with the file path as the language tag so the user can create the file in one click. Examples: ```package.json (then JSON content), ```src/index.js (then JS content), ```.gitignore (then content).',
      'When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it.',
    ].join('\n'),
    rightTabs: ['files', 'agent', 'train', 'publish', 'state'],
    showRunButton: true,
    runLabel: 'Run',
    showChecks: true,
    center: 'code-preview',
    dockBrain: true,
    publishPanel: 'site',
  },
  {
    id: 'mobile',
    label: 'Mobile',
    icon: '📱',
    tagline: 'Build a phone app and preview it in a device simulator, then scan to open it on your own handset.',
    brainSystemPrompt: [
      "You are an expert mobile app developer built into Builderforce.ai's browser IDE. The user is building a MOBILE app and previews it in a phone-sized device simulator.",
      'The project is a React Native app rendered for the web through react-native-web, so it runs in the browser preview AND stays portable to Expo. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" — never use HTML elements like div, span or button, and never use CSS files or className.',
      'Style with StyleSheet.create and flexbox. Remember there is no hover: design for touch, keep tap targets at least 44 points, and respect safe areas at the top and bottom of the screen.',
      'Design for a narrow portrait viewport (roughly 390 x 850 points) first. Prefer native navigation patterns — tab bars, stack headers, bottom sheets — over desktop patterns like sidebars and hover menus.',
      'When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```App.js (then the component), ```src/screens/Home.js.',
      'When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it.',
    ].join('\n'),
    rightTabs: ['files', 'agent', 'publish', 'state'],
    showRunButton: true,
    runLabel: 'Run',
    showChecks: true,
    center: 'device',
    dockBrain: true,
    publishPanel: 'site',
  },
  {
    id: 'webmobile',
    label: 'Web + Mobile',
    icon: '🖥️',
    tagline: 'Build a web application and a mobile app together from one codebase — preview both side by side.',
    brainSystemPrompt: [
      "You are an expert full-stack app developer built into Builderforce.ai's browser Builder. The user is building ONE app that ships as BOTH a responsive web application AND a mobile app, from a single codebase.",
      'The project is a React app rendered through react-native-web, so the SAME source runs full-width as a website AND inside a phone-sized device simulator, and stays portable to Expo for native iOS/Android. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" — never use HTML elements like div, span or button, and never use CSS files or className.',
      'Style with StyleSheet.create and flexbox, and make layouts RESPONSIVE: use flex, percentage widths and useWindowDimensions to adapt between a wide desktop viewport and a narrow phone one. Keep tap targets at least 44 points and respect safe areas — there is no hover on mobile.',
      'When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```App.js (then the component), ```src/screens/Home.js.',
      'When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it.',
    ].join('\n'),
    rightTabs: ['files', 'agent', 'publish', 'state'],
    showRunButton: true,
    runLabel: 'Run',
    showChecks: true,
    center: 'code-preview',
    dockBrain: true,
    publishPanel: 'site',
    enableMobilePreview: true,
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
    rightTabs: ['files', 'state'],
    showRunButton: false,
    runLabel: 'Run',
    showChecks: false,
    center: 'video',
    dockBrain: false,
    publishPanel: 'agent',
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
    rightTabs: ['files', 'publish', 'state'],
    showRunButton: false,
    runLabel: 'Run',
    showChecks: false,
    center: 'evermind',
    dockBrain: false,
    publishPanel: 'agent',
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
    rightTabs: ['files', 'train', 'publish', 'state'],
    showRunButton: false,
    runLabel: 'Run',
    showChecks: false,
    center: 'finetune',
    dockBrain: false,
    publishPanel: 'agent',
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
    rightTabs: ['voice', 'files', 'state'],
    showRunButton: true,
    runLabel: 'Generate',
    showChecks: false,
    center: 'voice',
    dockBrain: true,
    publishPanel: 'agent',
  },
];

/** The public registry — every modality's Brain prompt carries the shared
 *  strategy/OKR note (baked once here so getModality and direct reads agree). */
export const MODALITIES: ModalityDef[] = BASE_MODALITIES.map((m) => ({
  ...m,
  brainSystemPrompt: `${m.brainSystemPrompt}\n${STRATEGY_OKR_NOTE}`,
}));

export const DEFAULT_MODALITY: ProjectModality = 'designer';

/** Resolve a modality id (possibly stale/unknown/legacy) to its definition, defaulting
 *  to Designer. Legacy ids (e.g. the retired combined `llm`) map through the alias table. */
export function getModality(id: ProjectModality | string | null | undefined): ModalityDef {
  const resolved = (typeof id === 'string' && LEGACY_MODALITY_ALIASES[id]) || id;
  return MODALITIES.find((m) => m.id === resolved) ?? MODALITIES[0];
}
