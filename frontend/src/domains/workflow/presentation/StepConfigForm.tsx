'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { Icon } from '@/components/ui/Icon';
import { useFormat } from '@/i18n/useFormat';
import type { WorkflowNodeKind, WorkflowTriggerInfo } from '@/lib/builderforceApi';
import { NODE_KIND_MAP, isFieldVisible, nodeKindBlurb, nodeKindLabel, type ConfigField } from '../domain/stepCatalog';
import { integrationForConfig, integrationIcon } from '../domain/stepIntegrations';
import {
  configFieldLabel, configFieldPlaceholder, integrationDescription, integrationOperationLabel,
} from '../domain/stepCatalogI18n';
import { ConnectorNodeFields } from './ConnectorNodeFields';
import styles from './StepConfigForm.module.css';

/**
 * HOW A STEP IS CONFIGURED — once, for every surface that places one.
 *
 * ── WHY IT IS NOT PART OF `NodeConfigPanel` ANY MORE ─────────────────────────
 * This form was the body of the standalone builder's right-hand inspector, which
 * was fine while the builder was the only place a step existed. The Creation
 * Canvas now places steps directly, and a step's configuration is not a property
 * of WHERE it is drawn: `llm` needs a prompt, `connector` needs an action off the
 * tenant's live catalog, and every kind but `trigger`/`output` needs an error
 * policy, on the canvas exactly as in the builder. A second copy of that form
 * would be a second answer to one question, and the answer that drifts is the one
 * on the surface nobody was testing.
 *
 * So the panel keeps what is genuinely ITS own (the delete control, the run
 * history) and the form is this — identity, name, integration operation, the
 * catalog's typed fields, the error policy, and a trigger's activation state.
 *
 * ── WHAT IT DELIBERATELY DOES NOT OWN ────────────────────────────────────────
 * Outlets (the named paths out of a switch), declared data in and data out, and
 * the list of connections. Those are about how a step sits in a GRAPH, and the
 * canvas draws them on the board itself — see `FlowStepInspector`.
 *
 * Narrow contract: the kind, the config, and two callbacks. No node, no board, no
 * "which surface am I on" flag — it can be dropped into a third surface unchanged.
 */

export interface StepConfigFormProps {
  kind: WorkflowNodeKind;
  config: Record<string, unknown>;
  /** The step's authored name. Omitted where the surface owns the name itself
   *  (the canvas card's title is the object's title). */
  label?: string;
  onLabelChange?: (label: string) => void;
  /** A patch to merge into the config — never a whole config, so two edits in
   *  flight cannot clobber each other's fields. */
  onConfigChange: (patch: Record<string, unknown>) => void;
  /** Activation state for a trigger step (webhook URL, next run, …), if any. */
  triggerInfo?: WorkflowTriggerInfo;
}

export function StepConfigForm({ kind, config, label, onLabelChange, onConfigChange, triggerInfo }: StepConfigFormProps) {
  const fmt = useFormat();
  const t = useTranslations('evermindBuild');
  // The catalog's own strings (config-field labels and placeholders, and the
  // integration presets' descriptions and operation names) live under their own
  // namespace, keyed off the English text — see `stepCatalogI18n.ts`.
  const wb = useTranslations('workflowBuilder');
  const meta = NODE_KIND_MAP[kind];
  const integ = integrationForConfig(config);

  const setConfig = (key: string, value: unknown) => onConfigChange({ [key]: value });

  const renderField = (field: ConfigField) => {
    const value = config[field.key];
    if (field.type === 'select') {
      return (
        <Select className={styles.input} value={String(value ?? field.options?.[0] ?? '')} onChange={(e) => setConfig(field.key, e.target.value)}>
          {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
        </Select>
      );
    }
    if (field.type === 'textarea') {
      return (
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          value={String(value ?? '')}
          placeholder={configFieldPlaceholder(wb, field.placeholder)}
          onChange={(e) => setConfig(field.key, e.target.value)}
        />
      );
    }
    if (field.type === 'number') {
      return (
        <input
          type="number"
          className={styles.input}
          value={value == null ? '' : Number(value)}
          placeholder={configFieldPlaceholder(wb, field.placeholder)}
          onChange={(e) => setConfig(field.key, e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    }
    return (
      <input
        type="text"
        className={styles.input}
        value={String(value ?? '')}
        placeholder={configFieldPlaceholder(wb, field.placeholder)}
        onChange={(e) => setConfig(field.key, e.target.value)}
      />
    );
  };

  return (
    <div className={styles.form}>
      <div className={styles.identity}>
        <span><Icon source={integ ? integrationIcon(integ) : meta?.icon} size={20} /></span>
        <div>
          <b>{integ?.label ?? (meta ? nodeKindLabel(meta, t) : kind)}</b>
          <small>{integ ? integrationDescription(wb, integ.description) : (meta ? nodeKindBlurb(meta, t) : '')}</small>
        </div>
      </div>

      {onLabelChange && (
        <label className={styles.field}>
          {wb('nodeLabel')}
          <input className={styles.input} value={label ?? ''} onChange={(e) => onLabelChange(e.target.value)} />
        </label>
      )}

      {/* Integration operation picker, driven by the registry. */}
      {integ && integ.operations.length > 0 && (
        <label className={styles.field}>
          {wb('operationPicker')}
          <Select className={styles.input} value={String(config.operation ?? integ.operations[0]?.id ?? '')} onChange={(e) => setConfig('operation', e.target.value)}>
            {integ.operations.map((op) => <option key={op.id} value={op.id}>{integrationOperationLabel(wb, op.label)}</option>)}
          </Select>
        </label>
      )}

      {/* The connector step's options come from the tenant's live catalog rather
          than a static field list, so it brings its own editor. */}
      {kind === 'connector' && (
        <ConnectorNodeFields
          config={config}
          setConfig={setConfig}
          patchConfig={(patch) => onConfigChange(patch)}
        />
      )}

      {/* Catalog fields for this kind — hide the raw `operation` field when an
          integration is selected (the picker above replaces it), and hide fields
          whose `visibleWhen` predicate doesn't match the current config. */}
      {meta?.fields
        .filter((field) => !(integ && field.key === 'operation'))
        .filter((field) => isFieldVisible(field, config))
        .map((field) => (
          <label key={field.key} className={styles.field}>
            {configFieldLabel(wb, field.label)}
            {renderField(field)}
          </label>
        ))}

      {/* Generic error-handling policy — applies to ANY step kind (not a per-kind
          field, so it lives here rather than in the catalog's per-kind `fields`).
          Meaningless for `trigger` (never throws) and `output` (terminal), but
          harmless to show — hiding it there would need a kind-allowlist that drifts
          as kinds are added. */}
      {kind !== 'trigger' && kind !== 'output' && (
        <>
          <label className={styles.field}>
            {t('errorHandling.label')}
            <Select className={styles.input} value={String(config.onError ?? 'fail-task')} onChange={(e) => setConfig('onError', e.target.value)}>
              <option value="fail-task">{t('errorHandling.failTask')}</option>
              <option value="ignore">{t('errorHandling.ignore')}</option>
              <option value="resume">{t('errorHandling.resume')}</option>
              <option value="stop-branch">{t('errorHandling.stopBranch')}</option>
            </Select>
          </label>
          {config.onError === 'resume' && (
            <label className={styles.field}>
              {t('errorHandling.defaultValue')}
              <input
                type="text"
                className={styles.input}
                value={String(config.onErrorValue ?? '')}
                placeholder={t('errorHandling.defaultValuePlaceholder')}
                onChange={(e) => setConfig('onErrorValue', e.target.value)}
              />
            </label>
          )}
        </>
      )}

      {/* Trigger activation — how this trigger actually fires once saved. */}
      {kind === 'trigger' && triggerInfo && (
        <div className={styles.activation}>
          <div className={styles.activationHeading}>{t('activation.heading')}</div>
          {triggerInfo.webhookUrl && (
            <label className={styles.field}>
              {triggerInfo.hasSecret ? t('activation.webhookSigned') : t('activation.webhook')}
              <input readOnly className={styles.input} value={triggerInfo.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          {triggerInfo.emailAddress && (
            <label className={styles.field}>
              {t('activation.inboundEmail')}
              <input readOnly className={styles.input} value={triggerInfo.emailAddress} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          {triggerInfo.nextRunAt && <div className={styles.activationNote}>{t('activation.nextRun', { when: fmt.dateTime(triggerInfo.nextRunAt) })}</div>}
          {triggerInfo.lastStatus && (
            <div className={styles.activationNote}>
              {t('activation.last', { status: triggerInfo.lastStatus })}
              {triggerInfo.lastRunAt ? ` · ${fmt.dateTime(triggerInfo.lastRunAt)}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
