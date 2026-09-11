'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { TenantMember, PendingInvitation } from '@/lib/auth';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import { useRole, ASSIGNABLE_ROLES, type TenantRole } from '@/lib/rbac';
import { useRoleText } from '@/lib/useRoleText';
import { WorkforceCard, InitialAvatar } from './WorkforceCard';
import { MemberStatsStrip } from './MemberStatsStrip';
import { useWorkforceMetrics } from './WorkforceMetricsContext';
import PersonalitySummary from '@/components/PersonalitySummary';

const roleBadgeStyle: CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)', letterSpacing: 0.3,
};

/**
 * Role picker for a member, gated on `members.manageRoles` — it disables itself
 * (with a "Requires Manager role" hint) for users who can't manage roles rather
 * than vanishing. The `owner` option is offered only to an owner, since the API
 * permits only owners to grant/alter that role. Shared by the card + table so
 * neither re-implements the gate or the option list.
 *
 * Says what the chosen role can DO, not just its name: a person promoting someone
 * to Manager should not have to guess what that grants. The full line shows under
 * the picker on the card; the compact table variant carries it as the tooltip.
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
  const t = useTranslations('workforce.memberCard');
  const roleText = useRoleText();
  const myRole = useRole();
  const options = ASSIGNABLE_ROLES.filter((r) => r !== 'owner' || myRole === 'owner');
  const description = roleText.description(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: compact ? undefined : '1 1 180px' }}>
      <RoleGate capability="members.manageRoles">
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          aria-label={t('roleSelect')}
          title={description || undefined}
          style={{
            padding: compact ? '4px 8px' : '6px 10px', fontSize: 12,
            background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {options.map((r: TenantRole) => (
            <option key={r} value={r}>{roleText.label(r)}</option>
          ))}
        </Select>
      </RoleGate>
      {!compact && description && (
        <span data-testid="role-description" style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--text-muted)' }}>
          {description}
        </span>
      )}
    </div>
  );
}

/**
 * A person in the Workforce directory — an active human member or a pending
 * invite — rendered through the same {@link WorkforceCard} shell as agents, so
 * people and agents read as one workforce. The type pill (Human / Pending) is
 * the only signal of which is which.
 */

const mfaBadgeStyle: CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 'var(--radius-sm)',
  background: 'rgba(34,197,94,0.15)', color: 'var(--success-text)', letterSpacing: 0.3,
};

// Coral-outline destructive action, matching the old MembersView Remove button.
const dangerBtnStyle = (busy: boolean): CSSProperties => ({
  padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)',
  background: 'transparent', border: '1px solid var(--coral-bright)', borderRadius: 'var(--radius-md)',
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
  const t = useTranslations('workforce.memberCard');
  const roleText = useRoleText();
  const name = member.displayName ?? member.username ?? member.email;
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
          <span style={roleBadgeStyle} title={t('roleBadge')}>{roleText.label(member.role)}</span>
          {member.mfaEnabled && <span title={t('mfaEnabled')} style={mfaBadgeStyle}>{t('mfa')}</span>}
        </>
      }
      body={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <MemberStatsStrip scorecard={scorecard} engagement={engagement} />
          {/* This person's personality — self-hides when they haven't taken the test. */}
          <PersonalitySummary profile={member.psychometric ?? undefined} />
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('activeSessions', { count: member.activeSessions })}
          </div>
        </div>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <RoleSelect value={member.role} onChange={(role) => onChangeRole(member, role)} busy={changingRole} />
          <button type="button" onClick={() => onRemove(member)} disabled={removing} style={dangerBtnStyle(removing)}>
            {removing ? t('removing') : t('remove')}
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
  const t = useTranslations('workforce.memberCard');
  const roleText = useRoleText();
  return (
    <WorkforceCard
      avatar={<InitialAvatar label={invite.email} />}
      name={invite.email}
      subtitle={t('invitedAs', { role: roleText.label(invite.role) })}
      pill={{ kind: 'pending' }}
      body={
        <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
          {t('joinsOnSignup')}
        </div>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => onRevoke(invite)} disabled={revoking} style={dangerBtnStyle(revoking)}>
            {revoking ? t('revoking') : t('revoke')}
          </button>
        </div>
      }
    />
  );
}
