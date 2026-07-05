'use client';

/**
 * A user's OWN account security: the sessions signed in to their account across
 * devices, plus a read-only log of any platform-admin access to their account.
 *
 * This is personal account data (not workspace governance), so it lives on the
 * Settings → Sessions sub-tab. Extracted into its own component because it is
 * self-contained (its own fetches + i18n) and was previously tangled into the
 * workspace-security page. Reuses the existing `security` message namespace so
 * no strings are duplicated.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  mySessionsApi, myAdminAccessApi,
  type MySession, type MyAdminAccessSession,
} from '@/lib/builderforceApi';
import { SessionList } from '@/components/security/SessionList';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
};

export default function AccountSecurityPanel() {
  const t = useTranslations('security');

  const [mySessions, setMySessions] = useState<MySession[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [myError, setMyError] = useState<string | null>(null);
  const [adminAccess, setAdminAccess] = useState<MyAdminAccessSession[]>([]);
  const [loadingAdmin, setLoadingAdmin] = useState(true);

  useEffect(() => {
    mySessionsApi.list()
      .then(setMySessions)
      .catch((e: Error) => setMyError(e.message))
      .finally(() => setLoadingMine(false));
    myAdminAccessApi.list()
      .then(setAdminAccess)
      .catch(() => undefined) // non-critical; suppress errors
      .finally(() => setLoadingAdmin(false));
  }, []);

  const revokeMine = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => mySessionsApi.revoke(id)));
      setMySessions((prev) => prev.map((s) =>
        ids.includes(s.id) ? { ...s, isActive: false, revokedAt: new Date().toISOString() } : s
      ));
    } catch (e) {
      setMyError(e instanceof Error ? e.message : 'Revoke failed');
    }
  };

  return (
    <>
      {/* My active sessions */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ ...sectionTitle, marginBottom: 4 }}>{t('mySessions')}</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>{t('mySessionsSubtitle')}</p>
        {myError && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>{t('error', { message: myError })}</div>}
        {loadingMine ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingSessions')}</div>
        ) : (
          <SessionList sessions={mySessions} onRevoke={revokeMine} />
        )}
      </div>

      {/* Recent admin access */}
      <div style={cardStyle}>
        <div style={{ ...sectionTitle, marginBottom: 4 }}>{t('adminAccess')}</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>{t('adminAccessNote')}</p>
        {loadingAdmin ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</p>
        ) : adminAccess.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noAdminAccess')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {adminAccess.map((s) => {
              const dur = s.endedAt
                ? Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
                : null;
              const durStr = dur != null ? `${Math.floor(dur / 60)}m ${dur % 60}s` : t('active');
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    padding: '10px 14px', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)', borderRadius: 8, gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {s.tenantName}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                        {t('as')} {s.roleOverride}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      {new Date(s.startedAt).toLocaleString()}
                      {' · '}{t('duration')}: {durStr}
                      {s.writeBlockCount > 0 && (
                        <span style={{ color: 'var(--warning-fg, #f59e0b)', marginLeft: 6 }}>({t('writeBlocked', { count: s.writeBlockCount })})</span>
                      )}
                    </div>
                    {s.reason && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                        {t('reason')}: {s.reason}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      background: s.endedAt ? 'var(--bg-card)' : 'rgba(245,158,11,0.15)',
                      border: '1px solid',
                      borderColor: s.endedAt ? 'var(--border-subtle)' : 'rgba(245,158,11,0.5)',
                      color: s.endedAt ? 'var(--text-muted)' : 'var(--warning-fg, #f59e0b)',
                      flexShrink: 0,
                    }}
                  >
                    {s.endedAt ? t('ended') : t('active')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
