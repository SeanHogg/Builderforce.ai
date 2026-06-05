'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { NODE_KIND_MAP } from './nodeKinds';
import { integrationAccent, integrationForConfig, integrationIcon } from './integrations';

export interface BuilderNodeData extends Record<string, unknown> {
  kind: WorkflowNodeKind;
  label: string;
  config: Record<string, unknown>;
}

/** A short one-line summary of the node's key config, shown under the title. */
function configSummary(kind: WorkflowNodeKind, config: Record<string, unknown>): string {
  switch (kind) {
    case 'agent':
      return [config.role, config.runtime].filter(Boolean).join(' · ') || 'agent';
    case 'llm':
      return [config.provider, config.model].filter(Boolean).join(' · ') || 'llm';
    case 'mcp':
      return [config.integration, config.operation].filter(Boolean).join(' · ') || 'tool';
    case 'memory':
      return `${String(config.op ?? 'recall')}${config.query ? ` · ${String(config.query).slice(0, 24)}` : ''}`;
    case 'knowledge':
      return `${String(config.op ?? 'query')}${config.namespace ? ` · ${String(config.namespace)}` : ''}`;
    case 'train':
      return String(config.model || 'model');
    case 'trigger':
      return String(config.triggerType ?? 'manual');
    case 'output':
      return String(config.target ?? 'artifact');
    default:
      return '';
  }
}

/** Single renderer for every builder node, styled by kind. `trigger` has no
 *  target handle (it starts a flow); `output` has no source handle (terminal). */
function BuilderNodeImpl({ data, selected }: NodeProps) {
  const d = data as BuilderNodeData;
  const meta = NODE_KIND_MAP[d.kind];
  const accent = meta?.accent ?? 'var(--text-muted)';
  const summary = configSummary(d.kind, d.config ?? {});

  return (
    <div
      style={{
        minWidth: 168,
        background: 'var(--bg-elevated, #1a1c23)',
        border: `1px solid ${selected ? accent : 'var(--border-subtle, rgba(255,255,255,0.1))'}`,
        borderRadius: 10,
        boxShadow: selected ? `0 0 0 1px ${accent}` : 'none',
        overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ height: 3, background: accent }} />
      {d.kind !== 'trigger' && (
        <Handle type="target" position={Position.Left} style={{ background: accent, width: 9, height: 9 }} />
      )}
      <div style={{ padding: '8px 11px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 15 }}>{meta?.icon ?? '◻'}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary, #e2e5ec)' }}>
            {d.label || meta?.label || d.kind}
          </span>
        </div>
        <div
          style={{
            marginTop: 3,
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: accent,
          }}
        >
          {meta?.group ?? d.kind}
        </div>
        {summary && (
          <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--text-muted, #8a8f9c)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
            {summary}
          </div>
        )}
      </div>
      {d.kind !== 'output' && (
        <Handle type="source" position={Position.Right} style={{ background: accent, width: 9, height: 9 }} />
      )}
    </div>
  );
}

export const BuilderNode = memo(BuilderNodeImpl);
