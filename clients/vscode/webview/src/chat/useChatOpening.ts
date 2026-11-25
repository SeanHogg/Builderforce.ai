/**
 * WHAT the host-run's opening prompt is built FROM — as DATA. The persona the chat answers
 * as, the composer's run-shaping switches, the live editor context, the chat's project and
 * the per-turn limbic text. No prompt text is composed here: `prepareBrainRun` builds the one
 * opening prompt from this (`brain-embedded/src/runStore/openingSections.ts`), and the host
 * adds the gates, rules and workspace map it owns.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PERSONA,
  loadBrainPersonaAgentsVia,
  personaModel,
  type BrainPersonaAgent,
  type BrainPersonaChoice,
  type BrainRunOpening,
  type Effort,
} from '@seanhogg/builderforce-brain-embedded';
import type { AuthedFetch } from '../bridge/authedFetch';
import { getEditorContext, onEditorContext, type EditorContext, type InitData } from '../bridge/vscodeBridge';

export function useChatOpening({ init, apiReq, associatedProject, effort, webBrowsing }: {
  init: InitData;
  apiReq: AuthedFetch;
  associatedProject: { id: number; name: string } | null;
  effort: Effort;
  webBrowsing: boolean;
}) {
  // The per-turn LIMBIC/affective block for the CURRENT turn — fetched from the host
  // (which calls the gateway's affective endpoint with the user's personality) on each
  // submit, so the next run executes under the SAME limbic layer as the native
  // participant + cloud/on-prem agents. Lingers as the last computed block until the next
  // submit refreshes it; '' when neutral / offline (a no-op).
  const [turnLimbic, setTurnLimbic] = useState('');

  // Live editor context (active file / selection / open tabs), pushed by the host as
  // the user navigates, so the agent always knows what file is open. Seeded from init.
  const [editorCtx, setEditorCtx] = useState<EditorContext | undefined>(getEditorContext);
  useEffect(() => onEditorContext(setEditorCtx), []);

  // WHO the Brain answers as ("Acting as"): the default editor Brain, a modality
  // persona, or an agent assigned to the Brain — the same choices, from the same shared
  // persona domain, as the web composer. The run layers it over the editor's own prompt.
  // An agent persona also prefers the agent's own model; an explicit model pin in the `/`
  // menu still wins.
  const [persona, setPersona] = useState<BrainPersonaChoice>(DEFAULT_PERSONA);
  const [personaAgents, setPersonaAgents] = useState<BrainPersonaAgent[]>([]);
  useEffect(() => {
    let live = true;
    loadBrainPersonaAgentsVia(apiReq)
      .then((agents) => { if (live) setPersonaAgents(agents); })
      .catch(() => { /* no assigned agents to offer — the modality personas still are */ });
    return () => { live = false; };
  }, [apiReq]);
  const personaModelId = useMemo(() => personaModel(persona, personaAgents), [persona, personaAgents]);

  // The DYNAMIC per-turn limbic block (fetched on submit) wins when present — it already
  // carries the personality tone plus this turn's affect; before the first send it falls
  // back to the STATIC personality block (host-fetched once per session).
  const limbic = turnLimbic || init.personalityBlock || '';
  const opening = useMemo<BrainRunOpening>(() => ({
    hasWorkspace: init.hasWorkspace,
    // The map the panel was opened with: the run's fallback when the host's fresh scan is late (the host's wins).
    ...(init.grounding ? { grounding: init.grounding } : {}),
    persona: { choice: persona, agents: personaAgents },
    composer: { effort, web: webBrowsing },
    ...(editorCtx ? { editorContext: editorCtx } : {}),
    ...(associatedProject ? { project: associatedProject } : {}),
    ...(limbic ? { limbic } : {}),
  }), [init.hasWorkspace, init.grounding, persona, personaAgents, effort, webBrowsing, editorCtx, associatedProject, limbic]);

  return { opening, setTurnLimbic, persona, setPersona, personaAgents, personaModelId };
}
