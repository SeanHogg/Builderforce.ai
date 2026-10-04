import { useTranslations } from 'next-intl';
import { FlowExecutionSettings } from '../FlowExecutionSettings';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { asRecord } from './shared';

/**
 * What one authored step actually CALLS, in one line — "twilio → send_sms".
 * A step with no call to make returns null, and the body says so rather than
 * letting a bare title imply the step is configured.
 */
function stepCall(step: Record<string, unknown>): string | null {
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const connector = str(step.connector);
  if (connector) return `${connector} → ${str(step.action) || str(step.actionKey) || '?'}`;
  const model = str(step.model) || str(step.provider);
  if (model || str(step.prompt)) return model ? `LLM · ${model}` : 'LLM';
  const role = str(step.role);
  if (role) return `agent · ${role}`;
  return null;
}

export function WorkflowBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const steps = Array.isArray(data.steps)
    ? data.steps.slice(0, 12).map((step, index) => asRecord(step, { title: typeof step === 'string' ? step : t('stepIndex', { index: index + 1 }) }))
    : [];
  const linked = typeof data.resourceId === 'string' && data.resourceId.startsWith('workflow:');
  return (
    <div className={styles.configurableBody}>
      {/* The same readout the SECTION draws — one component, because a legacy card and
          the frame that replaced it must not disagree about what a run would do. */}
      <FlowExecutionSettings data={data} />
      {steps.length === 0 ? (
        // No invented stages. An empty workflow states that it is empty and what
        // it needs — the placeholder list that used to render here read as real
        // configuration and was the reason a Twilio request showed campaign steps.
        <div className={styles.workflowEmpty}>
          <strong>{t('workflowNoSteps')}</strong>
          <small>{t('workflowNoStepsHint')}</small>
        </div>
      ) : (
        <div className={styles.workflowSteps}>{steps.map((step, index) => {
          const call = stepCall(step);
          const status = typeof step.status === 'string' && step.status ? step.status : '';
          const normalized = status.toLowerCase();
          // Status comes from the step, never from its POSITION. The old body
          // drew step 1 green and step 2 blue on every workflow, so a card that
          // had never run looked half-complete.
          const dot = normalized.startsWith('fail') || normalized.startsWith('error') ? styles.failDot
            : normalized.startsWith('complete') || normalized.startsWith('done') || normalized === 'delivered' ? styles.doneDot
            : normalized.startsWith('run') || normalized.startsWith('progress') ? styles.liveDot
            : styles.idleDot;
          return (
            <div className={styles.workflowStep} key={`${String(step.title || 'step')}-${index}`}>
              <span className={dot} />
              <strong>{String(step.title || step.name || t('stepIndex', { index: index + 1 }))}</strong>
              {call ? <code>{call}</code> : <small>{t('stepNotConfigured')}</small>}
              <small>{status || (linked ? t('stepPending') : t('stepNotBuilt'))}</small>
            </div>
          );
        })}</div>
      )}
    </div>
  );
}
