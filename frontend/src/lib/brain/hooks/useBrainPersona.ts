import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  brainPersonaAgents,
  personaAgentOf,
  personaModalityOf,
  personaModel,
  personaSystemPrompt,
} from '@seanhogg/builderforce-brain-embedded';
import { PLATFORM_BRAIN_SYSTEM_PROMPT, type BrainModality } from '@/lib/brain';
import { agentAssignmentsApi, type AgentAssignment } from '@/lib/builderforceApi';
import { loadAgentPoolCached, type PoolAgent } from '@/lib/agentPool';
import { useModalityCopy } from '@/lib/useModalityCopy';

/**
 * Brain agent/persona switcher: the user can run the Brain as the default
 * assistant, as a built-in modality persona, or as one of the agents assigned
 * to the Brain (scope='brain' in the canonical agent-assignment model).
 */
export function useBrainPersona({ isPage, pinnedProjectId, modality }: {
  isPage: boolean;
  pinnedProjectId: number | null;
  modality: BrainModality;
}) {
  const tBrain = useTranslations('brain');
  // Docked in an IDE project, the persona STARTS as that project's modality: the
  // modality prompt was already the one in force there (see personaSystemPrompt
  // below), so leaving the picker on "Default Brain" only misreported which
  // persona was answering — open a Mobile project and the chat looked generic
  // even though it was the mobile coder. `modality` is the resolved id, so an
  // unknown/legacy value can't select a persona that isn't in the registry.
  const dockedPersona = !isPage && pinnedProjectId != null ? `modality:${modality}` : 'default';
  // Follow the project/modality the drawer is pinned to until the user picks a
  // persona themselves — after that their choice sticks for the session. Derived
  // rather than mirrored by an effect: no pick yet ⇒ the pinned persona.
  const [pickedPersona, setPickedPersona] = useState<string | null>(null);
  const personaSel = pickedPersona ?? dockedPersona;
  const choosePersona = useCallback((value: string) => {
    setPickedPersona(value);
  }, []);
  const [brainAgents, setBrainAgents] = useState<AgentAssignment[]>([]);
  const [agentPool, setAgentPool] = useState<PoolAgent[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all([agentAssignmentsApi.list('brain').catch(() => []), loadAgentPoolCached().catch(() => [])])
      .then(([a, p]) => { if (live) { setBrainAgents(a); setAgentPool(p); } });
    return () => { live = false; };
  }, []);
  // The Brain-assigned agents, named and model-resolved from the pool — the SAME join
  // (and the same persona domain) the editor's composer uses: brain-embedded
  // `brainPersona.ts`.
  const personaAgents = useMemo(() => brainPersonaAgents(brainAgents, agentPool), [brainAgents, agentPool]);
  const personaPrompt = useMemo(
    () => personaSystemPrompt(personaSel, personaAgents)
      // Default persona: the platform co-pilot prompt on the full Brain Storm page
      // AND on the floating drawer everywhere EXCEPT when it's pinned to an IDE
      // project (there the modality coding prompt — via resolveSystemPrompt — wins).
      ?? (isPage || pinnedProjectId == null ? PLATFORM_BRAIN_SYSTEM_PROMPT : undefined),
    [personaSel, personaAgents, isPage, pinnedProjectId],
  );
  // Route the Brain to the assigned agent's real model (its base_model; registered /
  // default agents → undefined). A PREFERENCE, not a pin: an explicit model chosen in
  // the `/` menu still wins — see the conversation hook's `model`.
  const personaModelId = useMemo(() => personaModel(personaSel, personaAgents), [personaSel, personaAgents]);

  const modalityCopy = useModalityCopy();
  const personaLabel = useMemo(() => {
    const modalityId = personaModalityOf(personaSel);
    if (modalityId) return tBrain('brainModality', { modality: modalityCopy(modalityId).label });
    if (personaSel.startsWith('agent:')) {
      const agent = personaAgentOf(personaSel, personaAgents);
      return agent ? tBrain('brainAs', { name: agent.name }) : tBrain('brainTitle');
    }
    return tBrain('brainDefault');
  }, [personaSel, personaAgents, tBrain, modalityCopy]);

  return { dockedPersona, personaSel, choosePersona, personaAgents, personaPrompt, personaModelId, personaLabel };
}
