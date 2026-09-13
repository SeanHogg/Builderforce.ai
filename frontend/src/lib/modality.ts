/**
 * Project modality — the mode Canvas Builder uses for a single project.
 *
 * One project, many modalities. A project named "BuilderForce Agents" is built across:
 *   - designer : the default app/agent builder (Preview + Code + WebContainer)
 *   - mobile   : the same builder, framed for phones (device simulator + scan-to-phone)
 *   - evermind : grow a living, self-teaching Evermind model (teach + Knowledge Map)
 *   - finetune : design datasets and train a classic LoRA model, then ship it
 *
 * AI video/3D generation used to be a modality here (`video`, mounting the studio
 * engine's `<StudioPanel>`). It is retired: client-side AI video/3D generation is now a
 * canvas-native capability — a `scene` canvas object opening into the `scene3d` surface
 * (`CanvasSceneGeneratorPanel.tsx`) — rather than a bolted-on project type with its own
 * IDE panel. No seed/fixture/migration data in this repo sets `modality: 'video'` on a
 * project row, so this retirement carries no known code-visible migration; whether any
 * REAL tenant already has a live `modality: 'video'` project (this WAS a working,
 * shipped generator, unlike the concurrent webdit work) could not be confirmed from the
 * codebase alone — see the Consolidated Gap Register entry this retirement adds.
 *
 * `evermind` and `finetune` were once a single combined `llm` modality; they are
 * now two distinct project types so the Studio no longer mixes "teach a living
 * model" with "train a LoRA adapter". Legacy `llm` projects resolve to `evermind`
 * (they were seeded with an Evermind recipe) — see `getModality`.
 *
 * Adding a modality = one entry here. Builder, Brain's system
 * prompt, and the center panel all read from this single registry — no
 * branching scattered across components.
 */

import { MODALITY_PERSONAS, type PersonaModalityId } from '@seanhogg/builderforce-brain-embedded';

/**
 * The modality id set is the Brain persona set — one definition, in brain-embedded,
 * because the VS Code composer offers the same personas and cannot import this file.
 */
export type ProjectModality = PersonaModalityId;

/** Legacy modality id (the combined LLM Studio) → its replacement. */
const LEGACY_MODALITY_ALIASES: Record<string, ProjectModality> = { llm: 'evermind' };

/** Right-panel tab ids Builder can surface. Each modality picks the relevant subset. */
export type RightTab = 'voice' | 'files' | 'agent' | 'train' | 'publish' | 'state';

/**
 * Which component fills Builder's centre pane. Naming the layout here (rather
 * than branching on the modality id inside Builder) is what keeps "add a
 * modality = one entry in this registry" true — `mobile` reuses the Designer's
 * whole run/build pipeline and differs only by rendering `device` instead of
 * `code-preview`.
 */
export type CenterPanel = 'code-preview' | 'device' | 'voice' | 'evermind' | 'finetune';

/** Which Publish panel the right rail shows: a hosted site, or a trained agent. */
export type PublishPanel = 'site' | 'agent';

export interface ModalityDef {
  id: ProjectModality;
  label: string;
  icon: string;
  /** One-line description of the project type, shown on Canvas Builder's
   *  "new project" chooser cards. Single source so the launcher doesn't inline copy. */
  tagline: string;
  /** Roadmap placeholder — switcher renders it disabled with a "soon" tag. */
  comingSoon?: boolean;
  /** Static system-prompt prefix injected into the Brain so the AI knows the
   *  active modality. Dynamic context (open file, etc.) is appended by the Brain.
   *  Sourced from brain-embedded's `MODALITY_PERSONAS` (with `icon`), the ONE
   *  definition the web and the editor's "Acting as" picker share. */
  brainSystemPrompt: string;
  /** Brain input placeholder for this modality. */
  /** Brain empty-state hint for this modality. */
  /** Right-panel tabs relevant to this modality, in display order. */
  rightTabs: RightTab[];
  /** Whether the green run button applies. Designer runs the WebContainer dev
   *  server; Voice generates speech. Evermind/fine-tune drive generation from their
   *  own panels, so they hide it. */
  showRunButton: boolean;
  /** Label for the green run button (e.g. "Run" for Designer, "Generate" for Voice). */
  runLabel: string;
  /** Whether the WebContainer Check + "Gate Run" controls apply — only the
   *  code-running Designer/Mobile modalities validate with type-check/lint/build. */
  showChecks: boolean;
  /** Which component fills the centre pane. */
  center: CenterPanel;
  /** Whether the agent chat is docked into the left panel. When false Builder
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

/**
 * The glyph that prefixes each right-panel tab. The tab's WORD is localized
 * (`ide.rightTab.<id>` via `useRightTabLabels`); the glyph is locale-independent
 * and lives here so the icon vocabulary stays with the registry that defines the
 * tabs. Nothing should render a tab label by concatenating these by hand — call
 * the hook.
 */
export const RIGHT_TAB_ICONS: Record<RightTab, string> = {
  voice: '🎙',
  files: '📁',
  agent: '🤖',
  train: '🧠',
  publish: '🚀',
  state: '🔬',
};

/** A registry entry before its Brain persona (prompt + glyph) is joined in. */
type ModalityEntry = Omit<ModalityDef, 'brainSystemPrompt' | 'icon'>;

const BASE_MODALITIES: ModalityEntry[] = [
  {
    id: 'designer',
    label: 'Website',
    tagline: 'Generate and build a website or web app with Preview, Code, and a live dev server.',
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
    tagline: 'Build a phone app and preview it in a device simulator, then scan to open it on your own handset.',
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
    tagline: 'Build a web application and a mobile app together from one codebase — preview both side by side.',
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
    id: 'evermind',
    label: 'Evermind',
    tagline: 'Grow a living Evermind model that learns from every project — teach it and watch its Knowledge Map fill in.',
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
    tagline: 'Design datasets and train a custom LoRA model, then benchmark, publish, and export it.',
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
    tagline: 'Clone and design a custom voice, then synthesize speech from it.',
    rightTabs: ['voice', 'files', 'state'],
    showRunButton: true,
    runLabel: 'Generate',
    showChecks: false,
    center: 'voice',
    dockBrain: true,
    publishPanel: 'agent',
  },
];

/** The public registry — each entry joined to its Brain persona (the prompt already
 *  carries the shared strategy/OKR note), so getModality and direct reads agree. */
export const MODALITIES: ModalityDef[] = BASE_MODALITIES.map((m) => ({
  ...m,
  icon: MODALITY_PERSONAS[m.id].icon,
  brainSystemPrompt: MODALITY_PERSONAS[m.id].prompt,
}));

export const DEFAULT_MODALITY: ProjectModality = 'designer';

/** Resolve a modality id (possibly stale/unknown/legacy) to its definition, defaulting
 *  to Designer. Legacy ids (e.g. the retired combined `llm`) map through the alias table. */
export function getModality(id: ProjectModality | string | null | undefined): ModalityDef {
  const resolved = (typeof id === 'string' && LEGACY_MODALITY_ALIASES[id]) || id;
  return MODALITIES.find((m) => m.id === resolved) ?? MODALITIES[0];
}
