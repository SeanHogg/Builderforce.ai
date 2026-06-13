'use client';

import type { CSSProperties } from 'react';
import type { TenantMember, PendingInvitation } from '@/lib/auth';
import { WorkforceCard, InitialAvatar } from './WorkforceCard';

/**
 * A person in the Workforce directory — an active human member or a pending
 * invite — rendered through the same {@link WorkforceCard} shell as agents, so
 * people and agents read as one workforce. The type pill (Human / Pending) is
 * the only signal of which is which.
 */

const mfaBadgeStyle: CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
  background: 'rgba(34,197,94,0.15)', color: '#22c55e', letterSpacing: 0.3,
};

// Coral-outline destructive action, matching the old MembersView Remove button.
const dangerBtnStyle = (busy: boolean): CSSProperties => ({
  padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)',
  background: 'transparent', border: '1px solid var(--coral-bright)', borderRadius: 8,
  cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
});

export function MemberCard({
  member,
  onRemove,
  removing = false,
}: {
  member: TenantMember;
  onRemove: (member: TenantMember) => void;
  removing?: boolean;
}) {
  const name = member.displayName ?? member.username ?? member.email;
  return (
    <WorkforceCard
      avatar={<InitialAvatar label={member.displayName ?? member.email} />}
      name={name}
      subtitle={member.email}
      pill={{ kind: 'human' }}
      badges={member.mfaEnabled ? <span title="MFA enabled" style={mfaBadgeStyle}>MFA</span> : undefined}
      body={
        <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
          {member.activeSessions} active session{member.activeSessions === 1 ? '' : 's'}
        </div>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => onRemove(member)} disabled={removing} style={dangerBtnStyle(removing)}>
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      }
    />
  );
}

export function PendingInviteCard({
  invite,
  onRevoke,
  revoking = false,
}: {
  invite: PendingInvitation;
  onRevoke: (invite: PendingInvitation) => void;
  revoking?: boolean;
}) {
  return (
    <WorkforceCard
      avatar={<InitialAvatar label={invite.email} />}
      name={invite.email}
      subtitle={`Invited as ${invite.role}`}
      pill={{ kind: 'pending' }}
      body={
        <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
          Joins automatically when they sign up with this email.
        </div>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => onRevoke(invite)} disabled={revoking} style={dangerBtnStyle(revoking)}>
            {revoking ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      }
    />
  );
}
