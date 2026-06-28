'use client';

import type { CSSProperties } from 'react';
import type { TenantMember, PendingInvitation } from '@/lib/auth';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import { useRole, ROLE_LABEL, ASSIGNABLE_ROLES, type TenantRole } from '@/lib/rbac';
import { WorkforceCard, InitialAvatar } from './WorkforceCard';
import { MemberStatsStrip } from './MemberStatsStrip';
import { useWorkforceMetrics } from './WorkforceMetricsContext';

const roleBadgeStyle: CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
  background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)', letterSpacing: 0.3,
};

/**
 * Role picker for a member, gated on `members.manageRoles` — it disables itself
 * (with a "Requires Manager role" hint) for users who can't manage roles rather
 * than vanishing. The `owner` option is offered only to an owner, since the API
 * permits only owners to grant/alter that role. Shared by the card + table so
 * neither re-implements the gate or the option list.
 */
export function RoleSelect({
  value,
  onChange,
  busy = false,
  compact = false,
}: {
  value: string;
  onChange: (role: string) => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const myRole = useRole();
  const options = ASSIGNABLE_ROLES.filter((r) => r !== 'owner' || myRole === 'owner');
  return (
    <RoleGate capability="members.manageRoles">
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
        aria-label="Member role"
        style={{
          padding: compact ? '4px 8px' : '6px 10px', fontSize: 12,
          background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
          borderRadius: 8, color: 'var(--text-primary)', cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {options.map((r: TenantRole) => (
          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
        ))}
      </Select>
    </RoleGate>
  );
}

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
  onChangeRole,
  removing = false,
  changingRole = false,
}: {
  member: TenantMember;
  onRemove: (member: TenantMember) => void;
  onChangeRole: (member: TenantMember, role: string) => void;
  removing?: boolean;
  changingRole?: boolean;
}) {
  const name = member.displayName ?? member.username ?? member.email;
  const roleLabel = ROLE_LABEL[member.role as TenantRole] ?? member.role;
  // Surface the same Performance + Contributors signals as their dedicated tabs,
  // looked up from the shared directory fetch (humans key both lookups on user id).
  const { scorecardFor, engagementFor } = useWorkforceMetrics();
  const scorecard = scorecardFor('human', member.id);
  const engagement = engagementFor(member.id);
  return (
    <WorkforceCard
      avatar={<InitialAvatar label={member.displayName ?? member.email} />}
      name={name}
      subtitle={member.email}
      pill={{ kind: 'human' }}
      badges={
        <>
          <span style={roleBadgeStyle} title="Workspace role">{roleLabel}</span>
          {member.mfaEnabled && <span title="MFA enabled" style={mfaBadgeStyle}>MFA</span>}
        </>
      }
      body={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <MemberStatsStrip scorecard={scorecard} engagement={engagement} />
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {member.activeSessions} active session{member.activeSessions === 1 ? '' : 's'}
          </div>
        </div>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <RoleSelect value={member.role} onChange={(role) => onChangeRole(member, role)} busy={changingRole} />
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
