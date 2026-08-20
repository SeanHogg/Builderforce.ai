'use client';

import { Select } from '@/components/Select';
import { useTranslations } from 'next-intl';

import type { Node } from '@xyflow/react';
import { NODE_KIND_MAP, isFieldVisible, nodeKindLabel, nodeKindBlurb, type ConfigField } from './nodeKinds';
import type { BuilderNodeData } from './BuilderNode';
import { integrationForConfig, integrationIcon } from './integrations';
import { configFieldLabel, configFieldPlaceholder, integrationDescription, integrationOperationLabel } from './workflowBuilderI18n';
import { ConnectorNodeFields } from './ConnectorNodeFields';
import type { WorkflowTriggerInfo } from '@/lib/builderforceApi';
import { Icon } from '@/components/ui/Icon';
import { useFormat } from "@/i18n/useFormat";

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  fontSize: 12.5,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
  marginTop: 3,
};

interface Props {
  node: Node<BuilderNodeData>;
  onChange: (nodeId: string, patch: Partial<BuilderNodeData>) => void;
  onDelete: (nodeId: string) => void;
  /** Activation state for a trigger node (webhook URL, next run, …), if any. */
  triggerInfo?: WorkflowTriggerInfo;
}

/** Right-hand inspector for the selected node — edits its label and the typed
 *  config fields declared in the node-kind catalog. */
export function NodeConfigPanel({ node, onChange, onDelete, triggerInfo }: Props) {
  const fmt = useFormat();
  const t = useTranslations('evermindBuild');
  // The catalog's own strings (config-field labels and placeholders, and the
  // integration presets' descriptions and operation names) live under their own
  // namespace, keyed off the English text — see `workflowBuilderI18n.ts`.
  const wb = useTranslations('workflowBuilder');
  const meta = NODE_KIND_MAP[node.data.kind];
  const config = node.data.config ?? {};
  // When this node is backed by a catalog integration, surface its operation
  // picker and identity instead of the generic kind chrome.
  const integ = integrationForConfig(config);

  const setConfig = (key: string, value: unknown) =>
    onChange(node.id, { config: { ...config, [key]: value } });

  const renderField = (f: ConfigField) => {
    const value = config[f.key];
    if (f.type === 'select') {
      return (
        <Select style={inputStyle} value={String(value ?? f.options?.[0] ?? '')} onChange={(e) => setConfig(f.key, e.target.value)}>
          {f.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </Select>
      );
    }
    if (f.type === 'textarea') {
      return (
        <textarea
          style={{ ...inputStyle, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }}
          value={String(value ?? '')}
          placeholder={configFieldPlaceholder(wb, f.placeholder)}
          onChange={(e) => setConfig(f.key, e.target.value)}
        />
      );
    }
    if (f.type === 'number') {
      return (
        <input
          type="number"
          style={inputStyle}
          value={value == null ? '' : Number(value)}
          placeholder={configFieldPlaceholder(wb, f.placeholder)}
          onChange={(e) => setConfig(f.key, e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    }
    return (
      <input
        type="text"
        style={inputStyle}
        value={String(value ?? '')}
        placeholder={configFieldPlaceholder(wb, f.placeholder)}
        onChange={(e) => setConfig(f.key, e.target.value)}
      />
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span><Icon source={integ ? integrationIcon(integ) : meta?.icon} size={20} /></span>
        <div>
          <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)' }}>{integ?.label ?? (meta ? nodeKindLabel(meta, t) : node.data.kind)}</div>
          <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{integ ? integrationDescription(wb, integ.description) : (meta ? nodeKindBlurb(meta, t) : '')}</div>
        </div>
      </div>

      <label style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, color: 'var(--text-secondary)' }}>
        {wb('nodeLabel')}
        <input
          style={inputStyle}
          value={node.data.label}
          onChange={(e) => onChange(node.id, { label: e.target.value })}
        />
      </label>

      {/* Integration operation picker, driven by the registry. */}
      {integ && integ.operations.length > 0 && (
        <label style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {wb('operationPicker')}
          <Select style={inputStyle} value={String(config.operation ?? integ.operations[0]?.id ?? '')} onChange={(e) => setConfig('operation', e.target.value)}>
            {integ.operations.map((op) => (
              <option key={op.id} value={op.id}>{integrationOperationLabel(wb, op.label)}</option>
            ))}
          </Select>
        </label>
      )}

      {/* The connector node's options come from the tenant's live catalog rather
          than a static field list, so it brings its own editor. */}
      {node.data.kind === 'connector' && (
        <ConnectorNodeFields
          config={config}
          setConfig={setConfig}
          patchConfig={(patch) => onChange(node.id, { config: { ...config, ...patch } })}
        />
      )}

      {/* Catalog fields for this kind — hide the raw `operation` field when an
          integration is selected (the picker above replaces it), and hide fields
          whose `visibleWhen` predicate doesn't match the current config. */}
      {meta?.fields
        .filter((f) => !(integ && f.key === 'operation'))
        .filter((f) => isFieldVisible(f, config))
        .map((f) => (
        <label key={f.key} style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {configFieldLabel(wb, f.label)}
          {renderField(f)}
        </label>
      ))}

      {/* Generic error-handling policy — applies to ANY node kind (not a
          per-kind field, so it lives here rather than in `nodeKinds.ts`'s
          per-kind `fields` list). Meaningless for `trigger` (never throws) and
          `output` (terminal), but harmless to show — hiding it there would need
          a kind-allowlist that drifts as kinds are added. */}
      {node.data.kind !== 'trigger' && node.data.kind !== 'output' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('errorHandling.label')}
            <Select
              style={inputStyle}
              value={String(config.onError ?? 'fail-task')}
              onChange={(e) => setConfig('onError', e.target.value)}
            >
              <option value="fail-task">{t('errorHandling.failTask')}</option>
              <option value="ignore">{t('errorHandling.ignore')}</option>
              <option value="resume">{t('errorHandling.resume')}</option>
              <option value="stop-branch">{t('errorHandling.stopBranch')}</option>
            </Select>
          </label>
          {config.onError === 'resume' && (
            <label style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('errorHandling.defaultValue')}
              <input
                type="text"
                style={inputStyle}
                value={String(config.onErrorValue ?? '')}
                placeholder={t('errorHandling.defaultValuePlaceholder')}
                onChange={(e) => setConfig('onErrorValue', e.target.value)}
              />
            </label>
          )}
        </div>
      )}

      {/* Trigger activation — how this trigger actually fires once saved. */}
      {node.data.kind === 'trigger' && triggerInfo && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 10px',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-deep)',
          }}
        >
          <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
            Activation
          </div>
          {triggerInfo.webhookUrl && (
            <label style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
              Webhook URL{triggerInfo.hasSecret ? ' (sign with X-Signature)' : ''}
              <input readOnly style={inputStyle} value={triggerInfo.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          {triggerInfo.emailAddress && (
            <label style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
              Inbound email address
              <input readOnly style={inputStyle} value={triggerInfo.emailAddress} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          {triggerInfo.nextRunAt && (
            <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
              Next run: {fmt.dateTime(triggerInfo.nextRunAt)}
            </div>
          )}
          {triggerInfo.lastStatus && (
            <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
              Last: {triggerInfo.lastStatus}
              {triggerInfo.lastRunAt ? ` · ${fmt.dateTime(triggerInfo.lastRunAt)}` : ''}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onDelete(node.id)}
        style={{
          marginTop: 'auto',
          padding: '7px 12px',
          fontSize: 'var(--font-size-small)',
          fontWeight: 600,
          background: 'transparent',
          color: 'var(--danger)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
        }}
      >
        Delete node
      </button>
    </div>
  );
}
