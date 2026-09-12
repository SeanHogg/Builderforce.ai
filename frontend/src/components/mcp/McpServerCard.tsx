'use client';

/**
 * One registered MCP server, as a card. Presentational: it renders the row's
 * facts and raises intent, so the same card serves the gallery grid and the table
 * view without either owning connection state.
 *
 * The three things an operator needs on sight are the server's reachability
 * (enabled), how it authenticates, and whether an OAuth grant is actually held —
 * a registration with no grant looks identical to a working one until a tool call
 * fails mid-run, which is the failure this card exists to make visible.
 */

import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import type { McpExtension } from '@/lib/mcpExtensionsApi';
import { statusColor, type StatusToneMap } from '@/lib/statusTone';

/** What the card reports on sight, derived from `enabled` + whether an OAuth grant is held. */
type McpServerStatus = 'disabled' | 'ready' | 'needsConsent';
const STATUS_TONE: StatusToneMap<McpServerStatus> = {
  disabled: 'neutral',
  ready: 'success',
  needsConsent: 'warning',
};

const card: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  background: 'var(--bg-base)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  justifyContent: 'space-between',
  minWidth: 0,
};
const action: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 11px',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  cursor: 'pointer',
};

export interface McpServerCardProps {
  server: McpExtension;
  busy?: boolean;
  onEdit: (server: McpExtension) => void;
  onToggleEnabled: (server: McpExtension) => void;
  onConnect: (server: McpExtension) => void;
  onDisconnect: (server: McpExtension) => void;
  onRemove: (server: McpExtension) => void;
  /** 'table' lays the card out as a row; 'card' as a tile. */
  layout?: 'card' | 'table';
}

export function McpServerCard(props: McpServerCardProps) {
  const t = useTranslations('mcpServers');
  const { server, busy } = props;
  const connected = server.authKind !== 'oauth' || server.oauthConnectedAt != null;
  const status: McpServerStatus = !server.enabled ? 'disabled' : connected ? 'ready' : 'needsConsent';
  const toolsLabel = server.allowedTools === null
    ? t('tools.all')
    : server.allowedTools.length === 0
      ? t('tools.none')
      : t('tools.some', { count: server.allowedTools.length });

  return (
    <article style={{ ...card, flexDirection: props.layout === 'table' ? 'row' : 'column', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{server.name}</strong>
          <span style={{ color: statusColor(STATUS_TONE, status), fontSize: 'var(--font-size-eyebrow)', fontWeight: 650 }}>● {t(`status.${status}`)}</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', margin: '6px 0 0', wordBreak: 'break-all' }}>{server.serverUrl}</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-eyebrow)', margin: '6px 0 0' }}>
          {t(`auth.${server.authKind}`)} · {toolsLabel}
        </p>
      </div>
      <RoleGate capability="mcp.manage" variant="inline">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={action} disabled={busy} onClick={() => props.onEdit(server)}>{t('actions.edit')}</button>
          <button type="button" style={action} disabled={busy} onClick={() => props.onToggleEnabled(server)}>
            {server.enabled ? t('actions.disable') : t('actions.enable')}
          </button>
          {server.oauthConnectedAt == null ? (
            <button type="button" style={action} disabled={busy} onClick={() => props.onConnect(server)}>{t('actions.connect')}</button>
          ) : (
            <button type="button" style={action} disabled={busy} onClick={() => props.onDisconnect(server)}>{t('actions.disconnect')}</button>
          )}
          <button type="button" style={{ ...action, color: 'var(--danger)' }} disabled={busy} onClick={() => props.onRemove(server)}>{t('actions.remove')}</button>
        </div>
      </RoleGate>
    </article>
  );
}
