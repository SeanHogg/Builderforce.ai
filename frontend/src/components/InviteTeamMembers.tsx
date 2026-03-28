'use client';

import { useState } from 'react';
import { inviteByEmail } from '@/lib/auth';

const ROLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'manager', label: 'Manager' },
  { value: 'viewer', label: 'Viewer' },
] as const;

interface Invite {
  email: string;
  role: string;
  status: 'pending' | 'sending' | 'sent' | 'error';
  errorMsg?: string;
}

interface InviteTeamMembersProps {
  tenantId: string;
  tenantToken: string;
}

/**
 * Reusable "Invite team members" component.
 * Looks up users by email and adds them to the workspace.
 */
export function InviteTeamMembers({ tenantId, tenantToken }: InviteTeamMembersProps) {
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
      await inviteByEmail(tenantToken, tenantId, trimmed, role);
      setInvites((prev) =>
        prev.map((i) => (i.email === trimmed ? { ...i, status: 'sent' } : i))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to invite';
      setInvites((prev) =>
        prev.map((i) => (i.email === trimmed ? { ...i, status: 'error', errorMsg: msg } : i))
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
        Add teammates to your workspace. They need a Builderforce account — if they don&apos;t
        have one yet, they can sign up at{' '}
        <a
          href="https://builderforce.ai/register"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}
        >
          builderforce.ai/register
        </a>
        .
      </p>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="email"
          placeholder="teammate@company.com"
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
        <select
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
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
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
          Invite
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
                border: `1px solid ${invite.status === 'error' ? 'var(--error-border, #e74c3c)' : invite.status === 'sent' ? 'rgba(34,197,94,0.3)' : 'var(--border-subtle)'}`,
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, color: 'var(--text-primary)' }}>{invite.email}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                {invite.role}
              </span>
              {invite.status === 'sending' && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sending…</span>
              )}
              {invite.status === 'sent' && (
                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>✓ Added</span>
              )}
              {invite.status === 'error' && (
                <span style={{ fontSize: 11, color: 'var(--error-text, #e74c3c)' }} title={invite.errorMsg}>
                  ✗ {invite.errorMsg ?? 'Error'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {invites.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          You can also invite teammates later from{' '}
          <a href="/settings/members" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
            Workspace Settings
          </a>
          .
        </p>
      )}
    </div>
  );
}
