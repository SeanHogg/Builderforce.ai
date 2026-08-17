'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { NODE_KIND_MAP } from './nodeKinds';
import { integrationAccent, integrationForConfig, integrationIcon } from './integrations';
import { Icon } from '@/components/ui/Icon';

export interface BuilderNodeData extends Record<string, unknown> {
  kind: WorkflowNodeKind;
  label: string;
  config: Record<string, unknown>;
}

/**
 * A short one-line summary of the node's key config, shown under the title.
 *
 * Exported so the 3D reading of the same graph says the same thing about a step
 * as the flat node does — two summaries of one node would read as two nodes.
 */
export function configSummary(kind: WorkflowNodeKind, config: Record<string, unknown>): string {
  switch (kind) {
    case 'agent':
      return [config.role, config.runtime].filter(Boolean).join(' · ') || 'agent';
    case 'llm':
      return [config.provider, config.model].filter(Boolean).join(' · ') || 'llm';
    case 'mcp':
      return [config.integration, config.operation].filter(Boolean).join(' · ') || 'tool';
    case 'connector':
      // Reads as "twilio · send_sms" on the canvas — which integration and which
      // action is the whole identity of this node.
      return [config.connector, config.action].filter(Boolean).join(' · ') || 'integration';
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
    case 'router':
      return String(config.fallback ? `→ ${config.fallback}` : 'routes');
    case 'switch':
      return String(config.field ? `on ${config.field}` : 'switch');
    case 'iterator':
      return 'per array item';
    case 'merge':
      return String(config.strategy ?? 'array');
    case 'numeric-aggregator':
      return String(config.op ?? 'sum');
    case 'table-aggregator':
      return 'rows';
    case 'text-aggregator':
      return `sep: ${JSON.stringify(String(config.separator ?? '\n'))}`;
    case 'set-variable':
    case 'get-variable':
    case 'increment':
      return String(config.key ?? '');
    case 'set-variables':
      return 'multiple';
    case 'get-variables':
      return String(config.keys ?? '');
    case 'sleep':
      return `${String(config.seconds ?? 0)}s`;
    case 'compose-string':
      return String(config.template ?? '{{input}}');
    case 'convert-encoding':
      return String(config.mode ?? 'base64-encode');
    case 'regex-match':
    case 'match-pattern-advanced':
      return String(config.pattern ?? '');
    case 'html-elements':
    case 'match-elements':
      return `<${String(config.tag ?? '')}>`;
    case 'replace':
      return String(config.pattern ?? '');
    case 'chunk-text':
      return `${String(config.chunkSize ?? 1000)} chars`;
    case 'assert':
      return String(config.expression ?? '');
    case 'healthcheck':
      return String(config.url ?? '');
    case 'web-search':
      return String(config.query ?? '{{input}}');
    case 'web-fetch':
      return String(config.url ?? '');
    case 'google-drive':
      return String(config.operation ?? 'search');
    case 'analyze-image':
      return String(config.url ?? '{{input}}');
    case 'extract-document-data':
      return String(config.fields ?? 'all fields');
    case 'transcribe-audio':
      return `${config.mode === 'translate' ? 'translate' : 'transcribe'}`;
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
        background: 'var(--bg-elevated)',
        border: `1px solid ${selected ? accent : 'var(--border-subtle, rgba(255,255,255,0.1))'}`,
        borderRadius: 'var(--radius-lg)',
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
          <span><Icon source={meta?.icon ?? 'template'} size={16} /></span>
          <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)' }}>
            {d.label || meta?.label || d.kind}
          </span>
        </div>
        <div
          style={{
            marginTop: 3,
            fontSize: 'var(--font-size-field-label)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: accent,
          }}
        >
          {meta?.group ?? d.kind}
        </div>
        {summary && (
          <div style={{ marginTop: 4, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
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
