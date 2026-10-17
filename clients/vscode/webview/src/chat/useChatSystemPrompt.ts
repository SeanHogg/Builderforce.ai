/**
 * WHAT the next turn is told, beyond the conversation itself — the chat's project, the
 * live editor context, the persona it answers as, the composer's run-shaping switches
 * and the per-turn limbic block — folded into the ONE `extraSystem` channel the web
 * Brain uses too. Lifted out of the chat surface: every input here is a directive, and
 * the surface only hands the result to `useBrainConversation`.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PERSONA,
  buildComposerDirectives,
  loadBrainPersonaAgentsVia,
  personaModel,
  personaOverlay,
  type BrainChat,
  type BrainPersonaAgent,
  type BrainPersonaChoice,
  type Effort,
} from '@seanhogg/builderforce-brain-embedded';
import type { AuthedFetch } from '../authedFetch';
import { getEditorContext, onEditorContext, type EditorContext, type InitData } from '../vscodeBridge';
import { activeProjectDirective, editorContextDirective } from '../../../src/idePersona';

/**
 * The chat's project, resolved chat-FIRST: a chat that belongs to a project is about
 * THAT project whatever the sidebar shows; a new chat falls back to the IDE's project.
 * The one resolution the directive, the header, Evermind and the triage report share.
 */
export function useAssociatedProject(init: InitData, activeChat: BrainChat | null) {
  const associatedProjectId = activeChat ? activeChat.projectId : (init.project?.id ?? null);
  const associatedProject = useMemo<{ id: number; name: string } | null>(() => {
    if (associatedProjectId == null) return null;
    const name = init.projectNames?.[String(associatedProjectId)]
      ?? (associatedProjectId === init.project?.id ? init.project?.name : undefined);
    return { id: associatedProjectId, name: name ?? `#${associatedProjectId}` };
  }, [associatedProjectId, init.projectNames, init.project?.id, init.project?.name]);
  return { associatedProjectId, associatedProject };
}

export function useChatSystemPrompt({ init, apiReq, associatedProject, effort, webBrowsing }: {
  init: InitData;
  apiReq: AuthedFetch;
  associatedProject: { id: number; name: string } | null;
  effort: Effort;
  webBrowsing: boolean;
}) {
  // The per-turn LIMBIC/affective block for the CURRENT turn — fetched from the host
  // (which calls the gateway's affective endpoint with the user's personality) on each
  // submit and folded into extraSystem, so the next run executes under the SAME limbic
  // layer as the native participant + cloud/on-prem agents. Lingers as the last computed
  // block until the next submit refreshes it; '' when neutral / offline (a no-op).
  const [turnLimbic, setTurnLimbic] = useState('');

  // Ambient project context — the SAME `extraSystem` channel the web Brain uses to tell
  // the model the current project, so platform tools (repos.*/tasks.*/…) default to it
  // instead of asking for a projectId. The id-less deltaVisibilityDirective is
  // intentionally not appended here — it is folded into the shared run loop's
  // chat-work-linking directive with the resolved chatId, so the ticket it mints
  // actually links to THIS conversation.
  const projectDirective = useMemo(
    () => activeProjectDirective(associatedProject) ?? '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [associatedProject?.id, associatedProject?.name],
  );

  // Live editor context (active file / selection / open tabs), pushed by the host as
  // the user navigates, so the agent always knows what file is open and can resolve
  // "this file" / "the selection" without guessing a path. Seeded from init.
  const [editorCtx, setEditorCtx] = useState<EditorContext | undefined>(getEditorContext);
  useEffect(() => onEditorContext(setEditorCtx), []);
  const editorDirective = useMemo(() => editorContextDirective(editorCtx) ?? '', [editorCtx]);

  // WHO the Brain answers as ("Acting as"): the default editor Brain, a modality
  // persona, or an agent assigned to the Brain — the same choices, from the same shared
  // persona domain, as the web composer. Here the persona LAYERS over the editor's own
  // prompt (which describes the real workspace, file tools and repository) instead of
  // replacing it — see `personaOverlay`. An agent persona also prefers the agent's own
  // model; an explicit model pin in the `/` menu still wins.
  const [persona, setPersona] = useState<BrainPersonaChoice>(DEFAULT_PERSONA);
  const [personaAgents, setPersonaAgents] = useState<BrainPersonaAgent[]>([]);
  useEffect(() => {
    let live = true;
    loadBrainPersonaAgentsVia(apiReq)
      .then((agents) => { if (live) setPersonaAgents(agents); })
      .catch(() => { /* no assigned agents to offer — the modality personas still are */ });
    return () => { live = false; };
  }, [apiReq]);
  const personaDirective = useMemo(() => personaOverlay(persona, personaAgents) ?? '', [persona, personaAgents]);
  const personaModelId = useMemo(() => personaModel(persona, personaAgents), [persona, personaAgents]);

  // The DYNAMIC per-turn limbic block (fetched on submit) wins when present — it already
  // carries the personality tone plus this turn's affect; before the first send it falls
  // back to the STATIC personality block (host-fetched once per session). '' (a no-op)
  // when the user has no profile.
  const extraSystem = useMemo(
    () => [personaDirective, projectDirective, editorDirective, buildComposerDirectives({ effort, web: webBrowsing }), turnLimbic || init.personalityBlock || '']
      .filter(Boolean)
      .join('\n\n'),
    [personaDirective, projectDirective, editorDirective, effort, webBrowsing, turnLimbic, init.personalityBlock],
  );

  return { extraSystem, setTurnLimbic, persona, setPersona, personaAgents, personaModelId };
}
