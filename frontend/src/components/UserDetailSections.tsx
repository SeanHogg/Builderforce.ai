import type { CSSProperties, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { Formatter } from '@/i18n/format';
import { formatElapsedBetween } from '@/lib/duration';
import type {
  AdminUser,
  AdminSecurityDetails,
  EffectivePermissions,
  ImpersonationSession,
} from '@/lib/adminApi';

/**
 * The read-only sections of the admin user-detail panel (`UserDetailDrawer`).
 *
 * The drawer owns state, fetching and the actions that mutate the user; these
 * components only render what they are handed, so each tab's markup lives in
 * one place and the panel file stays a panel.
 */

export type UserDetailTab = 'profile' | 'permissions' | 'sessions' | 'security' | 'access';

export const USER_DETAIL_TABS: readonly UserDetailTab[] = ['profile', 'permissions', 'sessions', 'security', 'access'];

/** Tabs whose data belongs to one workspace — they render the workspace picker. */
export function isTenantScopedTab(tab: UserDetailTab): boolean {
  return tab === 'permissions' || tab === 'sessions' || tab === 'security';
}

export function fmtDateTime(fmt: Formatter, d: string): string {
  return fmt.dateWith(d, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const sectionStyle: CSSProperties = { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 };

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderBottom: '1px solid var(--border)',
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-primary)',
};

const fieldLabelStyle: CSSProperties = { color: 'var(--text-muted)', minWidth: 120 };

const actionRowStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  paddingTop: 12,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

/** Tables keep their own horizontal scroll so a 360px panel never scrolls the page. */
const tableWrapStyle: CSSProperties = { overflowX: 'auto', maxWidth: '100%' };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

export function MutedNote({ children }: { children: ReactNode }) {
  return <p style={{ color: 'var(--text-muted)', margin: 0 }}>{children}</p>;
}

export function ProfileSection({ user, fmt, actions }: { user: AdminUser; fmt: Formatter; actions: ReactNode }) {
  const t = useTranslations('admin');
  return (
    <div style={sectionStyle}>
      <div>
        <Field label={t('users.drawer.fieldUserId')}>
          <code style={{ fontSize: 'var(--font-size-eyebrow)', fontFamily: 'var(--font-mono)' }}>{user.id}</code>
        </Field>
        <Field label={t('users.drawer.fieldUsername')}>{user.username ?? '—'}</Field>
        <Field label={t('users.drawer.fieldDisplayName')}>{user.displayName ?? '—'}</Field>
        <Field label={t('users.drawer.fieldSuperadmin')}>
          <span style={{ color: user.isSuperadmin ? 'var(--success-text)' : 'var(--text-muted)' }}>
            {user.isSuperadmin ? t('users.drawer.yes') : t('users.drawer.no')}
          </span>
        </Field>
        <Field label={t('users.drawer.fieldWorkspaces')}>{user.tenantCount}</Field>
        <Field label={t('users.drawer.fieldMemberSince')}>{fmtDateTime(fmt, user.createdAt)}</Field>
      </div>
      <div style={actionRowStyle}>{actions}</div>
    </div>
  );
}

export function PermissionsSection({ perms }: { perms: EffectivePermissions }) {
  const t = useTranslations('admin');
  const chipColour = (p: string) =>
    perms.userRevocations.includes(p)
      ? 'var(--error-text)'
      : perms.userGrants.includes(p)
        ? 'var(--coral-bright)'
        : 'var(--text-primary)';
  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <span>
          {t('users.drawer.roleLabel')} <strong>{perms.role}</strong>
        </span>
        <span style={{ color: 'var(--success-text)' }}>
          {t('users.drawer.effectivePermissionsCount', { count: perms.permissions.length })}
        </span>
        {perms.userGrants.length > 0 && (
          <span style={{ color: 'var(--coral-bright)' }}>
            +{t('users.drawer.userGrantsCount', { count: perms.userGrants.length })}
          </span>
        )}
        {perms.userRevocations.length > 0 && (
          <span style={{ color: 'var(--error-text)' }}>
            -{t('users.drawer.revocationsCount', { count: perms.userRevocations.length })}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {perms.permissions.map((p) => (
          <span
            key={p}
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              fontSize: 'var(--font-size-eyebrow)',
              fontFamily: 'var(--font-mono)',
              color: chipColour(p),
              overflowWrap: 'anywhere',
            }}
          >
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SessionsSection({ details, fmt }: { details: AdminSecurityDetails; fmt: Formatter }) {
  const t = useTranslations('admin');
  return (
    <div style={sectionStyle}>
      <div style={tableWrapStyle}>
        <table className="data-table" style={{ fontSize: 'var(--font-size-small)' }}>
          <thead>
            <tr>
              <th>{t('users.drawer.colSession')}</th>
              <th>{t('users.drawer.colIp')}</th>
              <th>{t('users.drawer.colLastSeen')}</th>
              <th>{t('users.drawer.colStatus')}</th>
              <th>{t('users.drawer.colTokens')}</th>
            </tr>
          </thead>
          <tbody>
            {details.sessions.map((s) => (
              <tr key={s.id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-eyebrow)' }}>{s.id.slice(0, 8)}…</td>
                <td>{s.ipAddress ?? '—'}</td>
                <td>{fmtDateTime(fmt, s.lastSeenAt)}</td>
                <td>
                  <span style={{ color: s.isActive ? 'var(--success-text)' : 'var(--text-muted)' }}>
                    {s.isActive ? t('users.drawer.statusActive') : t('users.drawer.statusRevoked')}
                  </span>
                </td>
                <td>{s.activeTokens}</td>
              </tr>
            ))}
            {details.sessions.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>
                  {t('users.drawer.noSessions')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SecuritySection({
  details,
  fmt,
  actions,
}: {
  details: AdminSecurityDetails;
  fmt: Formatter;
  actions: ReactNode;
}) {
  const t = useTranslations('admin');
  return (
    <div style={sectionStyle}>
      <div>
        <Field label={t('users.drawer.fieldMfa')}>
          <span style={{ color: details.mfa.enabled ? 'var(--success-text)' : 'var(--error-text)' }}>
            {details.mfa.enabled ? t('users.drawer.mfaEnabled') : t('users.drawer.mfaDisabled')}
          </span>
        </Field>
        {details.mfa.enabledAt && (
          <Field label={t('users.drawer.fieldMfaEnabledAt')}>{fmtDateTime(fmt, details.mfa.enabledAt)}</Field>
        )}
        <Field label={t('users.drawer.fieldActiveSessions')}>{details.sessions.filter((s) => s.isActive).length}</Field>
        <Field label={t('users.drawer.fieldActiveTokens')}>{details.tokens.filter((tok) => tok.isActive).length}</Field>
      </div>
      <div style={actionRowStyle}>{actions}</div>
    </div>
  );
}

export function AdminAccessSection({ sessions, fmt }: { sessions: ImpersonationSession[]; fmt: Formatter }) {
  const t = useTranslations('admin');
  if (sessions.length === 0) {
    return (
      <div style={sectionStyle}>
        <MutedNote>{t('users.drawer.noAdminAccess')}</MutedNote>
      </div>
    );
  }
  return (
    <div style={sectionStyle}>
      <div style={tableWrapStyle}>
        <table className="data-table" style={{ fontSize: 'var(--font-size-small)' }}>
          <thead>
            <tr>
              <th>{t('users.drawer.colAdmin')}</th>
              <th>{t('users.drawer.colWorkspace')}</th>
              <th>{t('users.drawer.colRole')}</th>
              <th>{t('users.drawer.colWhen')}</th>
              <th>{t('users.drawer.colDuration')}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.adminUserId.slice(0, 8)}…</td>
                <td>{s.tenantName}</td>
                <td>{s.roleOverride}</td>
                <td>{fmtDateTime(fmt, s.startedAt)}</td>
                <td>{formatElapsedBetween(s.startedAt, s.endedAt) ?? t('users.drawer.durationActive')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
