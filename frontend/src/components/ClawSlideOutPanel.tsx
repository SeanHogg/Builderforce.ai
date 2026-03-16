'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Claw } from '@/lib/builderforceApi';
import { ObservabilityContent } from './ObservabilityContent';
import { ClawDebugContent } from './ClawDebugContent';
import { CronJobsContent } from './CronJobsContent';
import { CapabilitiesContent } from './CapabilitiesContent';
import { ClawChatContent } from './ClawChatContent';
import { ClawSessionsContent } from './ClawSessionsContent';
import { ClawUsageContent } from './ClawUsageContent';
import { ClawWorkspaceContent } from './ClawWorkspaceContent';
import { ClawProjectsContent } from './ClawProjectsContent';
import { ClawChannelsContent } from './ClawChannelsContent';
import { ClawSkillsContent } from './ClawSkillsContent';
import { ClawConfigContent } from './ClawConfigContent';
import { ClawNodesContent } from './ClawNodesContent';

export type ClawPanelTab =
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

export interface ClawSlideOutPanelProps {
  claw: Claw;
  open: boolean;
  onClose: () => void;
  /** Current tenant id (number) for "Set as default" when available. */
  tenantId?: number | null;
  /** Current default claw id; if matches claw.id, show "Default" and "Clear default". */
  defaultClawId?: number | null;
  onSetDefaultClaw?: (clawId: number | null) => Promise<void>;
  initialTab?: ClawPanelTab;
}

const TABS: { id: ClawPanelTab; label: string }[] = [
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

export function ClawSlideOutPanel({
  claw,
  open,
  onClose,
  tenantId,
  defaultClawId,
  onSetDefaultClaw,
  initialTab = 'details',
}: ClawSlideOutPanelProps) {
  const [activeTab, setActiveTab] = useState<ClawPanelTab>(initialTab);
  const [savingDefault, setSavingDefault] = useState(false);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  const isDefault = defaultClawId != null && claw.id === defaultClawId;
  const canSetDefault = tenantId != null && onSetDefaultClaw;

  const handleSetDefault = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onSetDefaultClaw) return;
    setSavingDefault(true);
    try {
      await onSetDefaultClaw(claw.id);
    } finally {
      setSavingDefault(false);
    }
  };

  const handleClearDefault = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onSetDefaultClaw) return;
    setSavingDefault(true);
    try {
      await onSetDefaultClaw(null);
    } finally {
      setSavingDefault(false);
    }
  };

  const statusLabel = claw.status ?? (claw.connectedAt ? 'active' : 'offline');
  const slug = claw.slug;
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
        aria-label="Claw details"
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
            aria-label="Close panel"
          >
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{claw.name}</div>
            {claw.slug && (
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                {claw.slug}
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
                {savingDefault ? 'Updating…' : 'Clear default'}
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
                {savingDefault ? 'Setting…' : 'Set as default'}
              </button>
            ))}
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
                marginBottom: -1,
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
                  {[
                    { label: 'Name', value: claw.name },
                    { label: 'Slug', value: slug, mono: true },
                    { label: 'Status', value: statusLabel },
                    { label: 'Last seen', value: claw.lastSeenAt ? new Date(claw.lastSeenAt).toLocaleString() : '—' },
                    { label: 'Connected at', value: claw.connectedAt ? new Date(claw.connectedAt).toLocaleString() : '—' },
                    { label: 'Created', value: claw.createdAt ? new Date(claw.createdAt).toLocaleString() : '—' },
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
            <ClawChatContent clawId={claw.id} clawName={claw.name} />
          )}

          {activeTab === 'sessions' && (
            <ClawSessionsContent clawId={claw.id} />
          )}

          {activeTab === 'usage' && (
            <ClawUsageContent clawId={claw.id} />
          )}

          {activeTab === 'workspace' && (
            <ClawWorkspaceContent clawId={claw.id} />
          )}

          {activeTab === 'projects' && (
            <ClawProjectsContent clawId={claw.id} />
          )}

          {activeTab === 'config' && (
            <ClawConfigContent clawId={claw.id} />
          )}

          {activeTab === 'cron' && (
            <CronJobsContent clawId={claw.id} />
          )}

          {activeTab === 'channels' && (
            <ClawChannelsContent clawId={claw.id} />
          )}

          {activeTab === 'skills' && (
            <ClawSkillsContent clawId={claw.id} tenantId={tenantId} />
          )}

          {activeTab === 'capabilities' && (
            <CapabilitiesContent
              scope="claw"
              scopeId={claw.id}
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
                  Brainstorm / Brain
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
                  Projects
                </Link>
              </div>
            </div>
          )}

          {activeTab === 'nodes' && (
            <ClawNodesContent clawId={claw.id} />
          )}

          {activeTab === 'observability' && (
            <ObservabilityContent
              clawId={claw.id}
              clawName={claw.name}
              style={{ padding: 0 }}
            />
          )}

          {activeTab === 'debug' && (
            <ClawDebugContent
              clawId={claw.id}
              clawName={claw.name}
              compact
            />
          )}
        </div>
      </div>
    </>
  );
}
