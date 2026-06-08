'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  listTenantMembers,
  removeTenantMember,
  type TenantMember,
} from '@/lib/auth';
import { InviteTeamMembers } from '@/components/InviteTeamMembers';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { UpgradeModal } from '@/components/UpgradeModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';

/**
 * Workspace members content — list current members, invite new teammates, and
 * remove members. Seats are plan-limited, so invite/remove attempts that hit
 * the cap surface a shared UpgradeModal instead of a raw error.
 *
 * Self-contained surface: pulls tenant/token from auth and renders nothing
 * until a workspace is selected, so it drops cleanly into both the standalone
 * /settings/members page and the Workforce → Members tab. The host page owns
 * the heading chrome.
 */
export function MembersView() {
  const { tenant, tenantToken } = useAuth();

  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<TenantMember | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [inviteOpen, setInviteOpen] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!tenant || !tenantToken) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listTenantMembers(tenantToken, String(tenant.id));
      setMembers(list);
    } catch (e) {
      if (isPlanLimitError(e)) {
        setPlanError(e);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load members');
      }
    } finally {
      setLoading(false);
    }
  }, [tenant, tenantToken]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const handleRemove = async (member: TenantMember) => {
    if (!tenant || !tenantToken) return;
    setRemoving(member.id);
    try {
      await removeTenantMember(tenantToken, String(tenant.id), member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (e) {
      if (isPlanLimitError(e)) {
        setPlanError(e);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to remove member');
      }
    } finally {
      setRemoving(null);
      setConfirmRemove(null);
    }
  };

  if (!tenant || !tenantToken) return null;

  const inviteButton = (
    <button
      type="button"
      onClick={() => setInviteOpen(true)}
      style={{
        padding: '7px 16px',
        fontSize: 13,
        fontWeight: 600,
        background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      Invite
    </button>
  );

  return (
    <>
      {/* Invite slide-out panel */}
      <SlideOutPanel
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a teammate"
      >
        <div style={{ padding: 20 }}>
          <InviteTeamMembers
            tenantId={String(tenant.id)}
            tenantToken={tenantToken}
            onInvited={() => { void loadMembers(); }}
            onPlanLimit={(err) => setPlanError(err)}
          />
        </div>
      </SlideOutPanel>

      {/* Members list */}
      <section
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
            Current members
            {!loading && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--text-muted)',
                  marginLeft: 8,
                }}
              >
                ({members.length})
              </span>
            )}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ViewToggle value={viewMode} onChange={setViewMode} />
            {inviteButton}
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--error-bg)',
              border: '1px solid var(--error-border)',
              color: 'var(--error-text)',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
            Loading members…
          </div>
        ) : members.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
            No members yet. Use the Invite button to add your first teammate.
          </div>
        ) : viewMode === 'card' ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {members.map((m, idx) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 0',
                  borderTop: idx === 0 ? 'none' : '1px solid var(--border-subtle)',
                }}
              >
                <div
                  aria-hidden
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'var(--bg-base)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--coral-bright)',
                    flexShrink: 0,
                  }}
                >
                  {(m.displayName ?? m.email).slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.displayName ?? m.username ?? m.email}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.email}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {m.mfaEnabled && (
                    <span
                      title="MFA enabled"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: 'rgba(34,197,94,0.15)',
                        color: '#22c55e',
                        letterSpacing: 0.3,
                      }}
                    >
                      MFA
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {m.activeSessions} session{m.activeSessions === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(m)}
                    disabled={removing === m.id}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--coral-bright)',
                      background: 'transparent',
                      border: '1px solid var(--coral-bright)',
                      borderRadius: 8,
                      cursor: removing === m.id ? 'not-allowed' : 'pointer',
                      opacity: removing === m.id ? 0.6 : 1,
                    }}
                  >
                    {removing === m.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Member</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>MFA</th>
                  <th style={thStyle}>Sessions</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} style={trStyle}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {m.displayName ?? m.username ?? m.email}
                    </td>
                    <td style={tdMutedStyle}>{m.email}</td>
                    <td style={tdStyle}>
                      {m.mfaEnabled ? (
                        <span
                          title="MFA enabled"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: 'rgba(34,197,94,0.15)',
                            color: '#22c55e',
                            letterSpacing: 0.3,
                          }}
                        >
                          MFA
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={tdMutedStyle}>
                      {m.activeSessions} session{m.activeSessions === 1 ? '' : 's'}
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(m)}
                        disabled={removing === m.id}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--coral-bright)',
                          background: 'transparent',
                          border: '1px solid var(--coral-bright)',
                          borderRadius: 8,
                          cursor: removing === m.id ? 'not-allowed' : 'pointer',
                          opacity: removing === m.id ? 0.6 : 1,
                        }}
                      >
                        {removing === m.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!confirmRemove}
        message={
          confirmRemove
            ? `Remove ${confirmRemove.displayName ?? confirmRemove.email} from this workspace? They will lose access immediately.`
            : ''
        }
        confirmLabel="Remove"
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) void handleRemove(confirmRemove);
        }}
      />

      <UpgradeModal error={planError} onClose={() => setPlanError(null)} upgradeTarget="teams" />
    </>
  );
}
