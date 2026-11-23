/**
 * What a run's system prompt OPENS with — built in ONE place, from data, in ONE order. The
 * editor surfaces (the VS Code webview and the host) send DATA ({@link BrainRunOpening}); no
 * layer between them and `prepareBrainRun` composes prompt text.
 *
 *   1. the tenant's governance gates (binding; the same rows the tool seam enforces),
 *   2. the workspace's committed rules (`.builderforce/rules.md`),
 *   3. the host's own prompt (`resolvedSystemPrompt`: a sub-agent's role brief, an audit
 *      briefing, the native participant's prompt — empty for the panel's own runs),
 *   4. the IDE persona and the workspace map,
 *   5. the persona overlay, the project, the live editor context, the composer's
 *      switches and the limbic block.
 *
 * `prepareBrainRun` then appends what it resolves per run (recall, mode, ship contract …).
 */

import { renderPolicyDirectives, type PolicyGate } from '@builderforce/agent-tools';
import { buildComposerDirectives } from '../composerDirectives';
import { personaOverlay, type BrainPersonaAgent, type BrainPersonaChoice } from '../brainPersona';
import type { Effort } from '../effort';
import {
  activeProjectDirective,
  editorContextDirective,
  ideSystemPromptBase,
  withWorkspaceMap,
  type ActiveProject,
  type EditorContext,
} from '../ideSystemPrompt';

/** Rules beyond this are cut: a rules file is guidance, not a second codebase map. */
const RULES_MAX = 16_000;

/**
 * The data the opening prompt is built from. The surface fills the first group; the host
 * fills the second (it owns the policy, the rules file and the scanned workspace).
 */
export interface BrainRunOpening {
  /**
   * The IDE persona for a workspace (true) or none open (false). Absent ⇒ the run's host
   * prompt already carries its own persona (the native participant), so none is added.
   */
  hasWorkspace?: boolean;
  /** WHO the Brain answers as — a `BrainPersonaChoice`; layered over the IDE persona. */
  persona?: { choice: BrainPersonaChoice; agents: readonly BrainPersonaAgent[] };
  /** The composer's run-shaping switches. */
  composer?: { effort?: Effort; web?: boolean };
  /** The live editor context (active file, selection, tabs, repository). */
  editorContext?: EditorContext;
  /** The limbic / personality block for this turn, already rendered by the host that owns the profile. */
  limbic?: string;
  /** The chat's project. */
  project?: ActiveProject | null;
  /** Host: the scanned workspace map. */
  grounding?: string;
  /** Host: the tenant's governance gates. */
  gates?: readonly PolicyGate[];
  /** Host: the workspace's `.builderforce/rules.md`. */
  rules?: string;
}

/** The workspace rules, rendered as a system-prompt section ('' when there are none). */
export function renderWorkspaceRules(rules: string): string {
  const body = rules.trim();
  if (!body) return '';
  const clipped = body.length <= RULES_MAX ? body : `${body.slice(0, RULES_MAX)}\n…(rules truncated)`;
  return `Workspace rules (from .builderforce/rules.md, committed with this repository — follow them on every task here):\n${clipped}`;
}

/** The IDE persona with the workspace map under it ('' when the opening carries no IDE persona). */
function idePersonaSection(o: BrainRunOpening): string {
  if (o.hasWorkspace === undefined) return '';
  return withWorkspaceMap(ideSystemPromptBase(o.hasWorkspace), o.grounding);
}

/**
 * The run's full opening prompt. With no `opening` the host prompt is the whole opening
 * (a web run, or a host that still sends its own text).
 */
export function assembleOpening(hostPrompt: string, opening: BrainRunOpening | undefined): string {
  if (!opening) return hostPrompt;
  return [
    renderPolicyDirectives(opening.gates),
    renderWorkspaceRules(opening.rules ?? ''),
    hostPrompt,
    idePersonaSection(opening),
    opening.persona ? personaOverlay(opening.persona.choice, opening.persona.agents) ?? '' : '',
    activeProjectDirective(opening.project) ?? '',
    editorContextDirective(opening.editorContext) ?? '',
    buildComposerDirectives({ effort: opening.composer?.effort, web: opening.composer?.web }),
    opening.limbic ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
