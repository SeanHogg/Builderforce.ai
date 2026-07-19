'use client';

import { Select } from '@/components/Select';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { inviteByEmail } from '@/lib/auth';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';

const ROLE_VALUES = ['developer', 'manager', 'viewer'] as const;

interface Invite {
  email: string;
  role: string;
  // sending → in flight; added → joined now (had an account); invited → pending
  // invite recorded (no account yet); error → failed.
  status: 'sending' | 'added' | 'invited' | 'error';
  errorMsg?: string;
}

interface InviteTeamMembersProps {
  tenantId: string;
  tenantToken: string;
  /** Called when a member invite succeeds — parents can refresh their member list. */
  onInvited?: (email: string, role: string) => void;
  /** Called when the server returns a plan limit 402 — parents can surface the upgrade modal. */
  onPlanLimit?: (error: PlanLimitError) => void;
}

/**
 * Reusable "Invite team members" component.
 * Looks up users by email and adds them to the workspace.
 */
export function InviteTeamMembers({ tenantId, tenantToken, onInvited, onPlanLimit }: InviteTeamMembersProps) {
  const t = useTranslations('inviteMembers');
  const [email, setEmail]   = useState('');
  const [role, setRole]     = useState('developer');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    if (invites.some((i) => i.email === trimmed)) {
      setEmail('');
      return;
    }

    const entry: Invite = { email: trimmed, role, status: 'sending' };
    setInvites((prev) => [...prev, entry]);
    setEmail('');
    setAdding(true);

    try {
      const result = await inviteByEmail(tenantToken, tenantId, trimmed, role);
      setInvites((prev) =>
        prev.map((i) => (i.email === trimmed ? { ...i, status: result.status === 'pending' ? 'invited' : 'added' } : i))
      );
      onInvited?.(trimmed, role);
    } catch (err) {
      if (isPlanLimitError(err)) {
        // Drop the pending row — the upgrade modal is a better surface than
        // a red row with the raw server message.
        setInvites((prev) => prev.filter((i) => i.email !== trimmed));
        onPlanLimit?.(err);
      } else {
        const msg = err instanceof Error ? err.message : t('errFailed');
        setInvites((prev) =>
          prev.map((i) => (i.email === trimmed ? { ...i, status: 'error', errorMsg: msg } : i))
        );
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
        {t.rich('intro', { strong: (chunks) => <strong>{chunks}</strong> })}
      </p>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="email"
          placeholder={t('emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={adding}
          style={{
            flex: 1,
            padding: '9px 12px',
            fontSize: 14,
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={adding}
          style={{
            padding: '9px 12px',
            fontSize: 14,
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {ROLE_VALUES.map((r) => (
            <option key={r} value={r}>{t(`roles.${r}`)}</option>
          ))}
        </Select>
        <button
          type="submit"
          disabled={adding || !email.trim()}
          style={{
            padding: '9px 18px',
            fontSize: 14,
            fontWeight: 600,
            background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: adding || !email.trim() ? 'not-allowed' : 'pointer',
            opacity: adding || !email.trim() ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {t('invite')}
        </button>
      </form>

      {invites.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invites.map((invite) => (
            <div
              key={invite.email}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--bg-base)',
                border: `1px solid ${invite.status === 'error' ? 'var(--error-border, #e74c3c)' : invite.status === 'added' ? 'rgba(34,197,94,0.3)' : invite.status === 'invited' ? 'rgba(245,158,11,0.35)' : 'var(--border-subtle)'}`,
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, color: 'var(--text-primary)' }}>{invite.email}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {t(`roles.${invite.role}`)}
              </span>
              {invite.status === 'sending' && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('statusSending')}</span>
              )}
              {invite.status === 'added' && (
                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>✓ {t('statusAdded')}</span>
              )}
              {invite.status === 'invited' && (
                <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }} title={t('statusInvitedHint')}>✉ {t('statusInvited')}</span>
              )}
              {invite.status === 'error' && (
                <span style={{ fontSize: 11, color: 'var(--error-text, #e74c3c)' }} title={invite.errorMsg}>
                  ✗ {invite.errorMsg ?? t('statusError')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {invites.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t.rich('laterHint', {
            link: (chunks) => (
              <a href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
                {chunks}
              </a>
            ),
          })}
        </p>
      )}
    </div>
  );
}
