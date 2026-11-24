import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { AgentDeclarationForm } from './AgentDeclarationForm';
import { useAgentDeclaration } from './useAgentDeclaration';

export interface AgentDeclarationPanelProps {
  /** The board's project — whose manifest the agent is declared in. */
  projectId: number;
  onClose: () => void;
  /** The declaration was written; `agentId` is its key under `agents`. */
  onDeclared: (agentId: string) => void;
}

/**
 * "A feature in the app" — the panel the agent clarifier opens. Mounted only while open,
 * so every opening starts from an empty form.
 */
export function AgentDeclarationPanel({ projectId, onClose, onDeclared }: AgentDeclarationPanelProps) {
  const t = useTranslations('agentForm');
  const declaration = useAgentDeclaration(projectId, onDeclared);
  return (
    <SlideOutPanel open onClose={onClose} title={t('title')}>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)', margin: '0 0 14px' }}>{t('intro')}</p>
      <AgentDeclarationForm
        form={declaration.form}
        onChange={declaration.update}
        toolOptions={declaration.toolOptions}
        submitting={declaration.submitting}
        refusal={declaration.refusal}
        onSubmit={() => void declaration.submit()}
        onCancel={onClose}
      />
    </SlideOutPanel>
  );
}
