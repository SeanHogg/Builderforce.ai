'use client';

import { Select } from '@/components/Select';

import type { Node } from '@xyflow/react';
import { NODE_KIND_MAP, isFieldVisible, type ConfigField } from './nodeKinds';
import type { BuilderNodeData } from './BuilderNode';
import { integrationForConfig, integrationIcon } from './integrations';
import type { WorkflowTriggerInfo } from '@/lib/builderforceApi';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  fontSize: 12.5,
  border: '1px solid var(--border-subtle)',
  borderRadius: 7,
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
          placeholder={f.placeholder}
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
          placeholder={f.placeholder}
          onChange={(e) => setConfig(f.key, e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    }
    return (
      <input
        type="text"
        style={inputStyle}
        value={String(value ?? '')}
        placeholder={f.placeholder}
        onChange={(e) => setConfig(f.key, e.target.value)}
      />
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{integ ? integrationIcon(integ) : meta?.icon}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{integ?.label ?? meta?.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{integ?.description ?? meta?.blurb}</div>
        </div>
      </div>

      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
        Label
        <input
          style={inputStyle}
          value={node.data.label}
          onChange={(e) => onChange(node.id, { label: e.target.value })}
        />
      </label>

      {/* Integration operation picker, driven by the registry. */}
      {integ && integ.operations.length > 0 && (
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
          Operation
          <Select style={inputStyle} value={String(config.operation ?? integ.operations[0]?.id ?? '')} onChange={(e) => setConfig('operation', e.target.value)}>
            {integ.operations.map((op) => (
              <option key={op.id} value={op.id}>{op.label}</option>
            ))}
          </Select>
        </label>
      )}

      {/* Catalog fields for this kind — hide the raw `operation` field when an
          integration is selected (the picker above replaces it), and hide fields
          whose `visibleWhen` predicate doesn't match the current config. */}
      {meta?.fields
        .filter((f) => !(integ && f.key === 'operation'))
        .filter((f) => isFieldVisible(f, config))
        .map((f) => (
        <label key={f.key} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {f.label}
          {renderField(f)}
        </label>
      ))}

      {/* Trigger activation — how this trigger actually fires once saved. */}
      {node.data.kind === 'trigger' && triggerInfo && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 10px',
            border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-deep)',
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
            Activation
          </div>
          {triggerInfo.webhookUrl && (
            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Webhook URL{triggerInfo.hasSecret ? ' (sign with X-Signature)' : ''}
              <input readOnly style={inputStyle} value={triggerInfo.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          {triggerInfo.emailAddress && (
            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Inbound email address
              <input readOnly style={inputStyle} value={triggerInfo.emailAddress} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          {triggerInfo.nextRunAt && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Next run: {new Date(triggerInfo.nextRunAt).toLocaleString()}
            </div>
          )}
          {triggerInfo.lastStatus && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Last: {triggerInfo.lastStatus}
              {triggerInfo.lastRunAt ? ` · ${new Date(triggerInfo.lastRunAt).toLocaleString()}` : ''}
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
          fontSize: 12,
          fontWeight: 600,
          background: 'transparent',
          color: 'var(--danger, #dc2626)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        Delete node
      </button>
    </div>
  );
}
