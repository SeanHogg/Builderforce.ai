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
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';

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

export interface AgentHostSlideOutPanelProps {
  agentHost: AgentHost;
  open: boolean;
  onClose: () => void;
  /** Current tenant id (number) for "Set as default" when available. */
  tenantId?: number | null;
  /** Current default agentHost id; if matches agentHost.id, show "Default" and "Clear default". */
  defaultAgentHostId?: number | null;
  onSetDefaultAgentHost?: (agentHostId: number | null) => Promise<void>;
  /** Called after the agentHost is deregistered (deleted) so the parent can drop it from its list. */
  onDeleted?: (agentHostId: number) => void;
  initialTab?: AgentHostPanelTab;
}

const TABS: { id: AgentHostPanelTab; labelKey: string }[] = [
  { id: 'details', labelKey: 'tabDetails' },
  { id: 'chat', labelKey: 'tabChat' },
  { id: 'sessions', labelKey: 'tabSessions' },
  { id: 'usage', labelKey: 'tabUsage' },
  { id: 'workspace', labelKey: 'tabWorkspace' },
  { id: 'projects', labelKey: 'tabProjects' },
  { id: 'config', labelKey: 'tabConfig' },
  { id: 'cron', labelKey: 'tabCron' },
  { id: 'channels', labelKey: 'tabChannels' },
  { id: 'skills', labelKey: 'tabSkills' },
  { id: 'capabilities', labelKey: 'tabCapabilities' },
  { id: 'prds', labelKey: 'tabPrds' },
  { id: 'nodes', labelKey: 'tabNodes' },
  { id: 'observability', labelKey: 'tabObservability' },
  { id: 'debug', labelKey: 'tabDebug' },
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
  const confirm = useConfirm();
  const tc = useTranslations('common');
  const t = useTranslations('agentHostPanel');
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
    if (!(await confirm(tc('deregisterAgentHostConfirm', { name: agentHost.name })))) return;
    setDeleting(true);
    try {
      await agentHosts.deregister(agentHost.id);
      onDeleted?.(agentHost.id);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : t('deregisterFailed'));
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
        aria-label={t('dialogAriaLabel')}
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
            aria-label={t('closePanel')}
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
              {t('default')}
            </span>
          )}
          {canSetDefault &&
            (isDefault ? (
              <button
                type="button"
                onClick={handleClearDefault}
                disabled={savingDefault}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--bg-base)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  cursor: savingDefault ? 'wait' : 'pointer',
                }}
              >
                {savingDefault ? t('updating') : t('clearDefault')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSetDefault}
                disabled={savingDefault}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--surface-interactive)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  cursor: savingDefault ? 'wait' : 'pointer',
                }}
              >
                {savingDefault ? t('setting') : t('setAsDefault')}
              </button>
            ))}
          <button
            type="button"
            onClick={handleDeregister}
            disabled={deleting}
            title={t('deregisterTitle')}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--surface-danger-soft, rgba(239,68,68,0.12))',
              color: 'var(--danger, #ef4444)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              cursor: deleting ? 'wait' : 'pointer',
            }}
          >
            {deleting ? t('deregistering') : t('deregister')}
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
          {TABS.map(({ id, labelKey }) => (
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
                marginBottom: -1,
              }}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {activeTab === 'details' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={cardStyle}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>{t('overview')}</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {[
                    { label: t('fieldName'), value: agentHost.name },
                    { label: t('fieldSlug'), value: slug, mono: true },
                    { label: t('fieldStatus'), value: statusLabel },
                    { label: t('fieldLastSeen'), value: agentHost.lastSeenAt ? new Date(agentHost.lastSeenAt).toLocaleString() : '—' },
                    { label: t('fieldConnectedAt'), value: agentHost.connectedAt ? new Date(agentHost.connectedAt).toLocaleString() : '—' },
                    { label: t('fieldCreated'), value: agentHost.createdAt ? new Date(agentHost.createdAt).toLocaleString() : '—' },
                  ].filter(r => r.value).map(({ label, value, mono }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                      <span style={mono ? { fontFamily: 'var(--font-mono)' } : {}}>{value}</span>
                    </div>
                  ))}
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
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>{t('prdsHeading')}</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                {t('prdsDescription')}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Link
                  href="/brainstorm"
                  style={{
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: 'var(--surface-interactive)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    textDecoration: 'none',
                  }}
                >
                  {t('brainstormBrain')}
                </Link>
                <Link
                  href="/projects"
                  style={{
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: 'var(--surface-interactive)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    textDecoration: 'none',
                  }}
                >
                  {t('projectsLink')}
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
