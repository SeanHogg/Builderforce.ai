import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AgentDeclarationPanel } from './AgentDeclarationPanel';
import { useAppManifestPresence } from './useAgentDeclaration';

/**
 * What the canvas hands its composer and draws beside it so an "agent" request can become
 * an agent declared in the app: the clarifier's facts (`appAgents`) and the declaration
 * panel while it is open. `projectId` null — no project, or a reader who may not write —
 * offers nothing, so the composer never asks a question whose answer cannot be acted on.
 */
export function useAppAgentDeclarationHost(projectId: number | null, notify: (text: string) => void) {
  const t = useTranslations('agentForm');
  const [open, setOpen] = useState(false);
  const hasAppManifest = useAppManifestPresence(projectId);
  const close = () => setOpen(false);

  const appAgents = projectId == null ? undefined : { hasAppManifest, onDefine: () => setOpen(true) };
  const panel = open && projectId != null
    ? <AgentDeclarationPanel projectId={projectId} onClose={close} onDeclared={(agentId) => { close(); notify(t('declared', { id: agentId })); }} />
    : null;
  return { appAgents, panel };
}
