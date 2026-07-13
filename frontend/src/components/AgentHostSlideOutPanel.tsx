'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { agentHosts, type AgentHost } from '@/lib/builderforceApi';
import { ObservabilityContent } from './ObservabilityContent';
import { AgentHostDebugContent } from './AgentHostDebugContent';
import { CronJobsContent } from './CronJobsContent';
import { CapabilitiesContent } from './CapabilitiesContent';
import { AgentHostChatContent } from './AgentHostChatContent';
import { AgentHostSessionsContent } from './AgentHostSessionsContent';
import { AgentHostUsageContent } from './AgentHostUsageContent';
import { AgentHostWorkspaceContent } from './AgentHostWorkspaceContent';
import { AgentHostProjectsContent } from './AgentHostProjectsContent';
import { AgentHostChannelsContent } from './AgentHostChannelsContent';
import { AgentHostSkillsContent } from './AgentHostSkillsContent';
import { AgentHostConfigContent } from './AgentHostConfigContent';
import { AgentHostNodesContent } from './AgentHostNodesContent';

export type AgentHostPanelTab =
  | 'details'
  | 'chat'
  | 'sessions'
  | 'usage'
  | 'workspace'
  | 'projects'
  | 'config'
  | 'cron'
  | 'channels'
  | 'skills'
  | 'capabilities'
  | 'prds'
  | 'observability'
  | 'debug'
  | 'nodes';

const TABS: { id: AgentHostPanelTab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'chat', label: 'Chat' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'usage', label: 'Usage' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'projects', label: 'Projects' },
  { id: 'config', label: 'Config' },
  { id: 'cron', label: 'Cron' },
  { id: 'channels', label: 'Channels' },
  { id: 'skills', label: 'Skills' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'prds', label: 'PRDs' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'observability', label: 'Observability' },
  { id: 'debug', label: 'Debug' },
];

const panelOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9998,
};

const panelDrawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(620px, 96vw)',
  maxWidth: '100%',
  borderLeft: '1px solid var(--border-subtle)',
  boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

// Base style for action buttons within the header and PRDs section.
// Increased padding and set min dimensions for touch targets.
const actionButtonStyle: React.CSSProperties = {
  padding: '10px 18px', // Increased padding
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  cursor: 'pointer',
  fontFamily: 'var(--font-display)',
  minWidth: 44, // Ensure min touch target width
  minHeight: 44, // Ensure min touch target height
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export function AgentHostSlideOutPanel({
  agentHost,
  open,
  onClose,
  tenantId,
  defaultAgentHostId,
  onSetDefaultAgentHost,
  onDeleted,
  initialTab = 'details',
}: AgentHostSlideOutPanelProps) {
  const [activeTab, setActiveTab] = useState<AgentHostPanelTab>(initialTab);
  const [savingDefault, setSavingDefault] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  const isDefault = defaultAgentHostId != null && agentHost.id === defaultAgentHostId;
  const canSetDefault = tenantId != null && onSetDefaultAgentHost;

  const handleSetDefault = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onSetDefaultAgentHost) return;
    setSavingDefault(true);
    try {
      await onSetDefaultAgentHost(agentHost.id);
    } finally {
      setSavingDefault(false);
    }
  };

  const handleClearDefault = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onSetDefaultAgentHost) return;
    setSavingDefault(true);
    try {
      await onSetDefaultAgentHost(null);
    } finally {
      setSavingDefault(false);
    }
  };

  const handleDeregister = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    if (!confirm(`Deregister "${agentHost.name}"? Its API key will be revoked and it will no longer connect.`)) return;
    setDeleting(true);
    try {
      await agentHosts.deregister(agentHost.id);
      onDeleted?.(agentHost.id);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deregister');
    } finally {
      setDeleting(false);
    }
  };

  const statusLabel = agentHost.status ?? (agentHost.online ? 'active' : 'offline');
  const slug = agentHost.slug;
  const statusColor =
    statusLabel === 'active'
      ? 'var(--surface-success-soft, rgba(34,197,94,0.15))'
      : statusLabel === 'suspended'
        ? 'var(--surface-danger-soft, rgba(239,68,68,0.15))'
        : 'var(--bg-elevated)';

  // Chat tab needs full height; other tabs scroll naturally
  const bodyStyle: React.CSSProperties =
    activeTab === 'chat'
      ? { flex: 1, overflow: 'hidden', padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }
      : { flex: 1, overflow: 'auto', padding: 20 };

  return (
    <>
      <div
        className="project-panel-overlay slide-panel-overlay"
        role="presentation"
        style={panelOverlayStyle}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="project-panel-drawer slide-panel-drawer"
        style={panelDrawerStyle}
        role="dialog"
        aria-label="AgentHost details"
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            title="Close panel"
            aria-label="Close panel"
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{agentHost.name}</div>
            {agentHost.slug && (
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                {agentHost.slug}
              </div>
            )}
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              padding: '4px 8px',
              borderRadius: 6,
              background: statusColor,
              color: 'var(--text-secondary)',
            }}
          >
            {statusLabel}
          </span>
          {isDefault && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '4px 8px',
                borderRadius: 6,
                background: 'var(--surface-coral-soft, rgba(244,114,94,0.15))',
                color: 'var(--coral-bright, #f4726e)',
              }}
            >
              Default
            </span>
          )}
          {canSetDefault &&
            (isDefault ? (
              <button
                type="button"
                onClick={handleClearDefault}
                disabled={savingDefault}
                title={savingDefault ? 'Updating...' : 'Clear default agent host'}
                style={{ ...actionButtonStyle, background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
              >
                {savingDefault ? 'Updating…' : 'Clear default'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSetDefault}
                disabled={savingDefault}
                title={savingDefault ? 'Setting default...' : 'Set as default agent host'}
                style={{ ...actionButtonStyle, background: 'var(--surface-interactive)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
              >
                {savingDefault ? 'Setting…' : 'Set as default'}
              </button>
            ))}
          <button
            type="button"
            onClick={handleDeregister}
            disabled={deleting}
            title={deleting ? 'Deregistering...' : 'Deregister this remote agent'}
            style={{
              ...actionButtonStyle,
              background: 'var(--surface-danger-soft, rgba(239,68,68,0.12))',
              color: 'var(--danger, #ef4444)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {deleting ? 'Deregistering…' : 'Deregister'}
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            padding: '0 20px',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              style={{
                padding: '12px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: activeTab === id ? 'var(--coral-bright)' : 'var(--text-secondary)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === id ? '2px solid var(--coral-bright)' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                marginBottom: -1, // Pull border down to align with bottom edge
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {activeTab === 'details' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={cardStyle}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Overview</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {
                    [
                      { label: 'Name', value: agentHost.name },
                      { label: 'Slug', value: slug, mono: true },
                      { label: 'Status', value: statusLabel },
                      { label: 'Last seen', value: agentHost.lastSeenAt ? new Date(agentHost.lastSeenAt).toLocaleString() : '—' },
                      { label: 'Connected at', value: agentHost.connectedAt ? new Date(agentHost.connectedAt).toLocaleString() : '—' },
                      { label: 'Created', value: agentHost.createdAt ? new Date(agentHost.createdAt).toLocaleString() : '—' },
                    ].filter(r => r.value).map(({ label, value, mono }) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                        <span style={mono ? { fontFamily: 'var(--font-mono)' } : {}}>{value}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          )}

          {activeTab === 'chat' && (
            <AgentHostChatContent agentHostId={agentHost.id} agentHostName={agentHost.name} />
          )}

          {activeTab === 'sessions' && (
            <AgentHostSessionsContent agentHostId={agentHost.id} />
          )}

          {activeTab === 'usage' && (
            <AgentHostUsageContent agentHostId={agentHost.id} />
          )}

          {activeTab === 'workspace' && (
            <AgentHostWorkspaceContent agentHostId={agentHost.id} />
          )}

          {activeTab === 'projects' && (
            <AgentHostProjectsContent agentHostId={agentHost.id} />
          )}

          {activeTab === 'config' && (
            <AgentHostConfigContent agentHostId={agentHost.id} />
          )}

          {activeTab === 'cron' && (
            <CronJobsContent agentHostId={agentHost.id} />
          )}

          {activeTab === 'channels' && (
            <AgentHostChannelsContent agentHostId={agentHost.id} />
          )}

          {activeTab === 'skills' && (
            <AgentHostSkillsContent agentHostId={agentHost.id} tenantId={tenantId} />
          )}

          {activeTab === 'capabilities' && (
            <CapabilitiesContent
              scope="host"
              scopeId={agentHost.id}
              tenantId={tenantId != null ? String(tenantId) : undefined}
            />
          )}

          {activeTab === 'prds' && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>PRDs</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Product Requirements Documents are created and managed at the project level. Use Brain to draft PRDs and executable task plans, or open a project to view and edit its PRD.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Link
                  href="/brainstorm"
                  style={{
                    padding: '10px 18px', // Increased padding for touch target
                    fontSize: 13,
                    fontWeight: 600,
                    background: 'var(--surface-interactive)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10, // Larger radius
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 44, // Ensure min touch target size
                    minHeight: 44,
                  }}
                >
                  Brainstorm / Brain
                </Link>
                <Link
                  href="/projects"
                  style={{
                    padding: '10px 18px', // Increased padding for touch target
                    fontSize: 13,
                    fontWeight: 600,
                    background: 'var(--surface-interactive)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10, // Larger radius
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 44, // Ensure min touch target size
                    minHeight: 44,
                  }}
                >
                  Projects
                </Link>
              </div>
            </div>
          )}

          {activeTab === 'nodes' && (
            <AgentHostNodesContent agentHostId={agentHost.id} />
          )}

          {activeTab === 'observability' && (
            <ObservabilityContent
              agentHostId={agentHost.id}
              agentHostName={agentHost.name}
              style={{ padding: 0 }}
            />
          )}

          {activeTab === 'debug' && (
            <AgentHostDebugContent
              agentHostId={agentHost.id}
              agentHostName={agentHost.name}
              compact
            />
          )}
        </div>
      </div>
    </>
  );
}