'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  listTenantMembers,
  removeTenantMember,
  type TenantMember,
} from '@/lib/auth';
import { InviteTeamMembers } from '@/components/InviteTeamMembers';
import { UpgradeModal } from '@/components/UpgradeModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';

/**
 * Workspace members page — list current members, invite new teammates,
 * and remove members. Seats are plan-limited, so invite attempts that
 * hit the cap surface a shared UpgradeModal instead of a raw error.
 */
export default function MembersPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant, tenant, tenantToken } = useAuth();

  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<TenantMember | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/settings/members');
      return;
    }
    if (!hasTenant) {
      router.replace('/tenants?next=/settings/members');
    }
  }, [isAuthenticated, hasTenant, router]);

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

  if (!isAuthenticated || !hasTenant || !tenant || !tenantToken) return null;

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main className="max-w-4xl mx-auto px-4 py-6" style={{ fontFamily: 'var(--font-display)' }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 6 }}>Workspace members</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Invite teammates into <strong>{tenant.name}</strong> and manage who has access.
          </p>
        </header>

        {/* Invite section */}
        <section
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Invite a teammate</h2>
          <InviteTeamMembers
            tenantId={String(tenant.id)}
            tenantToken={tenantToken}
            onInvited={() => { void loadMembers(); }}
            onPlanLimit={(err) => setPlanError(err)}
          />
        </section>

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
              No members yet. Invite your first teammate above.
            </div>
          ) : (
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
      </main>
    </div>
  );
}
