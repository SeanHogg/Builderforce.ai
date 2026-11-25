import { useCallback, useEffect, useState } from 'react';
import { useErrorText } from '@/i18n/useErrorMessage';
import {
  declareAppAgent,
  loadAgentToolOptions,
  projectHasAppManifest,
  type AgentDeclarationRefusal,
} from '@/lib/canvas/appAgentDeclaration';
import { recordedFailure } from '@/lib/reportError';
import { agentFormToDraft, EMPTY_AGENT_FORM, type AgentFormState } from './AgentDeclarationForm';

/**
 * The declaration form's state and its two calls: the tool options it offers (loaded
 * once) and the submit to `app_manifest.add_agent`. The form itself holds nothing.
 */
export function useAgentDeclaration(projectId: number, onDeclared: (agentId: string) => void) {
  const errorText = useErrorText();
  const [form, setForm] = useState<AgentFormState>(EMPTY_AGENT_FORM);
  const [toolOptions, setToolOptions] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<AgentDeclarationRefusal | null>(null);

  useEffect(() => {
    let live = true;
    // Without options the form still declares an agent with no tools — a valid one — so a
    // failed load is recorded and shown as an empty list, never thrown away.
    void loadAgentToolOptions()
      .catch(recordedFailure('Loading the agent tool options', [] as string[]))
      .then((options) => { if (live) setToolOptions(options); });
    return () => { live = false; };
  }, []);

  const update = useCallback((patch: Partial<AgentFormState>) => setForm((current) => ({ ...current, ...patch })), []);

  const submit = async () => {
    setSubmitting(true);
    setRefusal(null);
    try {
      const result = await declareAppAgent(projectId, agentFormToDraft(form));
      if (result.ok) onDeclared(result.agentId);
      else setRefusal(result.refusal);
    } catch (error) {
      setRefusal({ error: errorText(error), issues: [] });
    } finally {
      setSubmitting(false);
    }
  };

  return { form, update, toolOptions, submitting, refusal, submit };
}

/**
 * Whether the board's project has an app manifest — the fact the "agent" clarifier
 * requires. False while unknown and for a board with no project.
 */
export function useAppManifestPresence(projectId: number | null): boolean {
  const [known, setKnown] = useState<{ projectId: number; present: boolean } | null>(null);
  useEffect(() => {
    if (projectId == null) return undefined;
    let live = true;
    void projectHasAppManifest(projectId)
      .catch(recordedFailure('Checking the project for an app manifest', false))
      .then((present) => { if (live) setKnown({ projectId, present }); });
    return () => { live = false; };
  }, [projectId]);
  return known !== null && known.projectId === projectId && known.present;
}
