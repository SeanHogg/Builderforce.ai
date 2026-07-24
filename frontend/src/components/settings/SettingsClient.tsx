'use client';

/**
 * Account & workspace settings, split into focused sub-views via a <PillTabs> bar
 * (?sub=) so no single view is an endless scroll:
 *   - Account (default): profile, language, connected accounts, get-hired opt-in
 *   - Personality: the user's own psychometric profile
 *   - Sessions: personal account security (moved here from /security)
 *   - Email: email language + lifecycle-mail consent (CAN-SPAM surface)
 *   - Workspace: workspace identity + jump-off links (owner tools)
 */

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import PageContainer from '@/components/PageContainer';
import PillTabs, { type PillTab } from '@/components/PillTabs';
import { RoleGate } from '@/components/RoleGate';
import {
  getStoredUser,
  getStoredTenant,
  getStoredWebToken,
  getLinkedAccounts,
  unlinkProvider,
  getOAuthUrl,
  getMe,
  updateMyPersonality,
} from '@/lib/auth';
import PsychometricEditor from '@/components/PsychometricEditor';
import PersonalitySummary from '@/components/PersonalitySummary';
import ForHireCard from '@/components/account/ForHireCard';
import EmailPreferencesCard from '@/components/account/EmailPreferencesCard';
import AccountSecurityPanel from '@/components/security/AccountSecurityPanel';
import TeamSpendLimits from '@/components/settings/TeamSpendLimits';
import type { PsychometricProfile } from '@/lib/psychometric';
import { clearPersonalityBlockCache } from '@/lib/usePersonalityBlock';

/**
 * Self-gating nav link to the API Keys page. Per product rule we don't hide the
 * link from non-owners — RoleGate shows it disabled with a "Requires Owner role"
 * hint so everyone can see the capability exists and who to ask.
 */
function ApiKeysSettingsLink({ label }: { label: string }) {
  return (
    <RoleGate capability="apiKeys.manage">
      <Link
        href="/settings/integrations"
        style={{
          padding: '6px 12px', fontSize: 12, fontWeight: 600,
          background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)', borderRadius: 8, textDecoration: 'none',
        }}
      >
        {label} →
      </Link>
    </RoleGate>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 14,
};

const OAUTH_PROVIDERS = [
  { id: 'google',    label: 'Google',    icon: 'G' },
  { id: 'github',    label: 'GitHub',    icon: '⌥' },
  { id: 'linkedin',  label: 'LinkedIn',  icon: 'in' },
  { id: 'microsoft', label: 'Microsoft', icon: 'M' },
];

export default function SettingsClient() {
  const t = useTranslations('settings');
  const sub = useSearchParams().get('sub') ?? '';
  const user = getStoredUser();
  const tenant = getStoredTenant();

  type LinkedAccount = { provider: string; email: string | null; displayName: string | null };
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [hasPassword, setHasPassword] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  // The signed-in user's OWN personality (universal, not Pro-gated). Loaded fresh
  // from /api/auth/me so it reflects the latest saved profile.
  const [personality, setPersonality] = useState<PsychometricProfile | undefined>(undefined);
  const [personalitySaving, setPersonalitySaving] = useState(false);
  const [personalityNotice, setPersonalityNotice] = useState('');

  useEffect(() => {
    const token = getStoredWebToken();
    if (!token) { setLoadingAccounts(false); return; }
    getLinkedAccounts(token)
      .then(({ accounts, hasPassword: hp }) => { setLinkedAccounts(accounts); setHasPassword(hp); })
      .catch((e: Error) => setAccountsError(e.message))
      .finally(() => setLoadingAccounts(false));
    getMe(token)
      .then(({ psychometric }) => setPersonality(psychometric ?? undefined))
      .catch(() => { /* best-effort — the editor still lets the user set one */ });

    // Show connect error from redirect if present
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'already_linked_other') {
      setConnectError(t('providerAlreadyLinked'));
    }
  }, [t]);

  const handleConnect = (providerId: string) => {
    const token = getStoredWebToken();
    if (!token) return;
    window.location.href = getOAuthUrl(providerId, '/settings', token);
  };

  const handleUnlink = async (provider: string) => {
    const token = getStoredWebToken();
    if (!token) return;
    setUnlinking(provider);
    try {
      await unlinkProvider(token, provider);
      setLinkedAccounts((prev) => prev.filter((a) => a.provider !== provider));
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : 'Failed to disconnect');
    } finally {
      setUnlinking(null);
    }
  };

  const savePersonality = async () => {
    const token = getStoredWebToken();
    if (!token) return;
    setPersonalitySaving(true);
    setPersonalityNotice('');
    try {
      const saved = await updateMyPersonality(token, personality ?? null);
      setPersonality(saved ?? undefined);
      // Invalidate the session-cached chat personality block so the new tone is
      // picked up on the next Brain message instead of only after a reload.
      clearPersonalityBlockCache();
      setPersonalityNotice(t('personalitySaved'));
    } catch (e) {
      setPersonalityNotice(e instanceof Error ? e.message : t('personalitySaveFailed'));
    } finally {
      setPersonalitySaving(false);
    }
  };

  const subTabs: PillTab[] = [
    { id: '', label: t('accountTab'), icon: '👤', href: '/settings' },
    { id: 'personality', label: t('personality'), icon: '🧠', href: '/settings?sub=personality' },
    { id: 'sessions', label: t('sessionsTab'), icon: '🔒', href: '/settings?sub=sessions' },
    { id: 'email', label: t('emailTab'), icon: '✉️', href: '/settings?sub=email' },
    ...(tenant ? [
      { id: 'workspace', label: t('workspace'), icon: '🏢', href: '/settings?sub=workspace' },
      { id: 'spend', label: t('spendLimits'), icon: '💳', href: '/settings?sub=spend' },
    ] : []),
  ];

  const renderAccount = () => (
    <>
      {/* Profile */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={sectionTitle}>{t('profile')}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            { label: t('email'), value: user?.email },
            { label: t('displayName'), value: user?.name },
            { label: t('userId'), value: user?.id, mono: true },
          ].filter((r) => r.value).map(({ label, value, mono }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={mono ? { fontFamily: 'var(--font-mono)', fontSize: 11 } : {}}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Language */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={sectionTitle}>{t('language')}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('languageDescription')}</span>
          <LanguageSwitcher />
        </div>
      </div>

      {/* Get hired — opt in to being available for hire (builders only; self-gating). */}
      <div style={{ marginBottom: 20 }}>
        <ForHireCard />
      </div>

      {/* Connected Accounts */}
      <div style={cardStyle}>
        <div style={sectionTitle}>{t('connectedAccounts')}</div>

        {connectError && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 12 }}>{connectError}</div>
        )}
        {accountsError && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 12 }}>{t('error', { message: accountsError })}</div>
        )}

        {loadingAccounts ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {OAUTH_PROVIDERS.map(({ id, label, icon }) => {
              const linked = linkedAccounts.find((a) => a.provider === id);
              return (
                <div
                  key={id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '0.75rem', background: 'var(--bg-surface)',
                    borderRadius: 6, flexShrink: 0,
                  }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                    {linked && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {linked.email ?? linked.displayName ?? t('connected')}
                      </div>
                    )}
                  </div>
                  {linked ? (
                    <button
                      type="button"
                      onClick={() => void handleUnlink(id)}
                      disabled={unlinking === id}
                      style={{
                        padding: '4px 10px', fontSize: 11, fontWeight: 600, flexShrink: 0,
                        background: 'none', color: 'var(--text-muted)',
                        border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer',
                      }}
                    >
                      {unlinking === id ? '…' : t('disconnect')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleConnect(id)}
                      style={{
                        padding: '4px 10px', fontSize: 11, fontWeight: 600, flexShrink: 0,
                        background: 'var(--surface-interactive)', color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer',
                      }}
                    >
                      {t('connect')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!hasPassword && linkedAccounts.length <= 1 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
            {t('singleSignInWarning')}
          </p>
        )}
      </div>
    </>
  );

  const renderPersonality = () => (
    <div style={cardStyle}>
      <div style={sectionTitle}>{t('personality')}</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>{t('personalityDescription')}</p>
      <div style={{ display: 'grid', gap: 14 }}>
        <PersonalitySummary profile={personality} />
        <PsychometricEditor value={personality} onChange={setPersonality} forceUnlocked />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {personalityNotice && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{personalityNotice}</span>}
          <button
            type="button"
            onClick={savePersonality}
            disabled={personalitySaving}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              background: 'var(--accent, #6366f1)', color: '#fff', border: 'none', opacity: personalitySaving ? 0.6 : 1,
            }}
          >
            {personalitySaving ? t('personalitySaving') : t('personalitySave')}
          </button>
        </div>
      </div>
    </div>
  );

  const renderWorkspace = () => {
    if (!tenant) return null;
    return (
      <div style={cardStyle}>
        <div style={sectionTitle}>{t('workspace')}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            { label: t('name'), value: tenant.name },
            { label: t('slug'), value: tenant.slug, mono: true },
            { label: t('id'), value: tenant.id, mono: true },
          ].filter((r) => r.value).map(({ label, value, mono }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={mono ? { fontFamily: 'var(--font-mono)', fontSize: 11 } : {}}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            href="/tenants"
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: 'var(--surface-interactive)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 8, textDecoration: 'none',
            }}
          >
            {t('switchWorkspace')}
          </Link>
          <Link
            href="/security"
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)', borderRadius: 8, textDecoration: 'none',
            }}
          >
            {t('manageMemberSessions')} →
          </Link>
          <ApiKeysSettingsLink label={t('apiKeysLink')} />
        </div>
      </div>
    );
  };

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>{t('title')}</h1>

      <PillTabs tabs={subTabs} activeId={sub} ariaLabel={t('subnavLabel')} />

      {sub === 'personality'
        ? renderPersonality()
        : sub === 'sessions'
          ? <AccountSecurityPanel />
          : sub === 'email'
            ? <EmailPreferencesCard />
            : sub === 'workspace'
              ? renderWorkspace()
              : sub === 'spend'
                ? <TeamSpendLimits />
                : renderAccount()}
    </PageContainer>
  );
}
