/*
 * No `'use client'` here on purpose. `SecurityClient.tsx` is this panel's only
 * importer and already declares the boundary, so a directive here would mark a
 * second entry point that does not exist — the exact shape the architecture
 * ratchet's changelog keeps finding and removing.
 */

/**
 * Connecting an institution — enterprise SSO, and the LMS platforms that launch
 * into this workspace.
 *
 * Two things on one surface because they are the same job at two moments: SSO is
 * how the institution's people sign in, and an LTI registration is how their
 * course reaches a board. A university's IT department does both in the same
 * afternoon, from the same two configuration screens on their side.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────────────
 * LTI registrations lived in the `LTI_REGISTRATIONS` Cloudflare secret, so adding
 * a university was `wrangler secret put` by whoever holds deploy credentials, and
 * key rotation was manual. SSO did not exist at all.
 *
 * ── SAML ─────────────────────────────────────────────────────────────────────
 * Not implemented in-process, deliberately, and the panel says so rather than
 * omitting the option and leaving an administrator to guess. A Shibboleth or
 * InCommon IdP connects through an SSO gateway that already speaks SAML; only
 * OIDC runs here. The reasoning is in `application/auth/enterpriseSso.ts`.
 *
 * Every write is manager+ (`RoleGate` mirrors the server's `requireRole` and
 * DISABLES rather than hides, so an administrator can see what exists and knows
 * who to ask).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ltiRegistrationsApi,
  ssoConnectionsApi,
  type LtiRegistration,
  type LtiToolUrls,
  type SsoConnection,
} from '@/lib/builderforceApi';
import { useConfirm } from '@/components/ConfirmProvider';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 'var(--font-size-body)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
};

const primaryButton: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 'var(--font-size-body)',
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent-strong, var(--surface-interactive))',
  color: 'var(--text-on-accent, var(--text-primary))',
  border: '1px solid var(--border-subtle)',
  cursor: 'pointer',
};

const quietButton: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  cursor: 'pointer',
};

const codeStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-primary)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 8px',
  wordBreak: 'break-all',
  overflowWrap: 'anywhere',
};

const badge = (tone: 'ok' | 'warn'): React.CSSProperties => ({
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 700,
  padding: '2px 6px',
  borderRadius: 'var(--radius-sm)',
  background: tone === 'ok' ? 'rgba(34,197,94,0.12)' : 'var(--bg-elevated)',
  color: tone === 'ok' ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)',
  border: '1px solid var(--border-subtle)',
});

const emptySso = {
  label: '',
  issuer: '',
  discoveryUrl: '',
  authorizationUrl: '',
  tokenUrl: '',
  jwksUrl: '',
  userinfoUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid email profile',
  jitProvisioning: true,
  defaultRole: 'developer',
};

const emptyLti = {
  label: '',
  issuer: '',
  clientId: '',
  deploymentIds: '',
  authLoginUrl: '',
  accessTokenUrl: '',
  keySetUrl: '',
};

export default function IdentityProvidersPanel() {
  const t = useTranslations('identityProviders');
  const confirm = useConfirm();

  const [connections, setConnections] = useState<SsoConnection[]>([]);
  const [redirectUri, setRedirectUri] = useState('');
  const [registrations, setRegistrations] = useState<LtiRegistration[]>([]);
  const [toolUrls, setToolUrls] = useState<LtiToolUrls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ssoDraft, setSsoDraft] = useState<typeof emptySso | null>(null);
  const [ssoEditingId, setSsoEditingId] = useState<number | null>(null);
  const [ltiDraft, setLtiDraft] = useState<typeof emptyLti | null>(null);
  const [ltiEditingId, setLtiEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [domainDraft, setDomainDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Both lists in parallel — they are independent reads and one panel should
      // not take two round trips in series to paint.
      const [sso, lti] = await Promise.all([
        ssoConnectionsApi.list(),
        ltiRegistrationsApi.list(),
      ]);
      setConnections(sso.connections);
      setRedirectUri(sso.redirectUri);
      setRegistrations(lti.registrations);
      setToolUrls(lti.tool);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // -------------------------------------------------------------------------
  // SSO
  // -------------------------------------------------------------------------

  const openSso = (connection?: SsoConnection) => {
    setSsoEditingId(connection?.id ?? null);
    setSsoDraft(connection
      ? {
        label: connection.label,
        issuer: connection.issuer,
        discoveryUrl: connection.discoveryUrl ?? '',
        authorizationUrl: connection.authorizationUrl ?? '',
        tokenUrl: connection.tokenUrl ?? '',
        jwksUrl: connection.jwksUrl ?? '',
        userinfoUrl: connection.userinfoUrl ?? '',
        clientId: connection.clientId,
        // Never pre-filled: the server does not return it, and an empty value on
        // save means "leave the stored secret alone" rather than "blank it".
        clientSecret: '',
        scopes: connection.scopes,
        jitProvisioning: connection.jitProvisioning,
        defaultRole: connection.defaultRole,
      }
      : { ...emptySso });
  };

  const saveSso = async () => {
    if (!ssoDraft) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        label: ssoDraft.label,
        issuer: ssoDraft.issuer,
        discoveryUrl: ssoDraft.discoveryUrl || null,
        authorizationUrl: ssoDraft.authorizationUrl || null,
        tokenUrl: ssoDraft.tokenUrl || null,
        jwksUrl: ssoDraft.jwksUrl || null,
        userinfoUrl: ssoDraft.userinfoUrl || null,
        clientId: ssoDraft.clientId,
        ...(ssoDraft.clientSecret ? { clientSecret: ssoDraft.clientSecret } : {}),
        scopes: ssoDraft.scopes,
        jitProvisioning: ssoDraft.jitProvisioning,
        defaultRole: ssoDraft.defaultRole,
      };
      if (ssoEditingId) await ssoConnectionsApi.update(ssoEditingId, payload);
      else await ssoConnectionsApi.create(payload);
      setSsoDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeSso = async (connection: SsoConnection) => {
    if (!await confirm({
      title: t('removeConnectionTitle'),
      message: t('removeConnectionMessage', { label: connection.label }),
      confirmLabel: t('remove'),
      destructive: true,
    })) return;
    try {
      await ssoConnectionsApi.remove(connection.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addDomain = async (connectionId: number) => {
    const domain = (domainDraft[connectionId] ?? '').trim();
    if (!domain) return;
    try {
      await ssoConnectionsApi.addDomain(connectionId, domain);
      setDomainDraft((prev) => ({ ...prev, [connectionId]: '' }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const verifyDomain = async (domainId: number) => {
    try {
      const result = await ssoConnectionsApi.verifyDomain(domainId);
      if (!result.verified) setError(t('domainNotFound', { record: result.recordName }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // -------------------------------------------------------------------------
  // LTI
  // -------------------------------------------------------------------------

  const openLti = (registration?: LtiRegistration) => {
    setLtiEditingId(registration?.id ?? null);
    setLtiDraft(registration
      ? {
        label: registration.label,
        issuer: registration.issuer,
        clientId: registration.clientId,
        deploymentIds: registration.deploymentIds.join(', '),
        authLoginUrl: registration.authLoginUrl,
        accessTokenUrl: registration.accessTokenUrl,
        keySetUrl: registration.keySetUrl,
      }
      : { ...emptyLti });
  };

  const saveLti = async () => {
    if (!ltiDraft) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...ltiDraft,
        deploymentIds: ltiDraft.deploymentIds.split(/[\s,]+/).filter(Boolean),
      };
      if (ltiEditingId) await ltiRegistrationsApi.update(ltiEditingId, payload);
      else await ltiRegistrationsApi.create(payload);
      setLtiDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const rotateKey = async (registration: LtiRegistration) => {
    if (!await confirm({
      title: t('rotateKeyTitle'),
      message: t('rotateKeyMessage', { label: registration.label }),
      confirmLabel: t('rotate'),
      destructive: true,
    })) return;
    try {
      await ltiRegistrationsApi.rotateKey(registration.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleRegistration = async (registration: LtiRegistration) => {
    try {
      if (registration.status === 'active') await ltiRegistrationsApi.disable(registration.id);
      else await ltiRegistrationsApi.enable(registration.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // -------------------------------------------------------------------------

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    hint?: string,
    placeholder?: string,
  ) => (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      <input
        style={inputStyle}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ ...cardStyle, fontSize: 'var(--font-size-body)', color: 'var(--coral-bright)' }}>{error}</div>
      )}

      {/* ── Enterprise SSO ─────────────────────────────────────────────── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('ssoTitle')}</h2>
            <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '2px 0 0', maxWidth: '60ch' }}>{t('ssoSubtitle')}</p>
          </div>
          <RoleGate capability="identity.manageProviders">
            <button type="button" style={primaryButton} onClick={() => openSso()}>{t('addConnection')}</button>
          </RoleGate>
        </div>

        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 12px', maxWidth: '70ch' }}>{t('samlNote')}</p>

        {redirectUri && (
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={{ ...labelStyle, marginBottom: 4 }}>{t('redirectUri')}</div>
            <code style={codeStyle}>{redirectUri}</code>
            <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('redirectUriHint')}</p>
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)' }}>{t('loading')}</div>
        ) : connections.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
            {t('noConnections')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {connections.map((connection) => (
              <div key={connection.id} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 600, color: 'var(--text-primary)' }}>{connection.label}</div>
                    <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>{connection.issuer}</div>
                  </div>
                  <span style={badge(connection.status === 'active' ? 'ok' : 'warn')}>{connection.protocol.toUpperCase()}</span>
                  <RoleGate capability="identity.manageProviders">
                    <button type="button" style={quietButton} onClick={() => openSso(connection)}>{t('edit')}</button>
                  </RoleGate>
                  <RoleGate capability="identity.manageProviders">
                    <button type="button" style={quietButton} onClick={() => void removeSso(connection)}>{t('remove')}</button>
                  </RoleGate>
                </div>

                <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                  <div style={{ ...labelStyle, marginBottom: 8 }}>{t('domains')}</div>
                  {connection.domains.length === 0 && (
                    <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 8px' }}>{t('noDomains')}</p>
                  )}
                  {connection.domains.map((domain) => (
                    <div key={domain.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>{domain.domain}</span>
                        <span style={badge(domain.verified ? 'ok' : 'warn')}>
                          {domain.verified ? t('verified') : t('unverified')}
                        </span>
                        {!domain.verified && (
                          <RoleGate capability="identity.manageProviders">
                            <button type="button" style={quietButton} onClick={() => void verifyDomain(domain.id)}>{t('verify')}</button>
                          </RoleGate>
                        )}
                        <RoleGate capability="identity.manageProviders">
                          <button
                            type="button"
                            style={quietButton}
                            onClick={() => void ssoConnectionsApi.removeDomain(domain.id).then(load).catch((e: Error) => setError(e.message))}
                          >
                            {t('remove')}
                          </button>
                        </RoleGate>
                      </div>
                      {!domain.verified && (
                        <div style={{ marginTop: 6 }}>
                          <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '0 0 4px' }}>{t('domainProof')}</p>
                          <code style={codeStyle}>{`_builderforce-sso.${domain.domain}  TXT  ${domain.verifyToken}`}</code>
                        </div>
                      )}
                    </div>
                  ))}
                  <RoleGate capability="identity.manageProviders">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        style={{ ...inputStyle, flex: 1, minWidth: 180 }}
                        placeholder={t('domainPlaceholder')}
                        value={domainDraft[connection.id] ?? ''}
                        onChange={(e) => setDomainDraft((prev) => ({ ...prev, [connection.id]: e.target.value }))}
                      />
                      <button type="button" style={quietButton} onClick={() => void addDomain(connection.id)}>{t('addDomain')}</button>
                    </div>
                  </RoleGate>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── LTI 1.3 ────────────────────────────────────────────────────── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('ltiTitle')}</h2>
            <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '2px 0 0', maxWidth: '60ch' }}>{t('ltiSubtitle')}</p>
          </div>
          <RoleGate capability="identity.manageProviders">
            <button type="button" style={primaryButton} onClick={() => openLti()}>{t('addRegistration')}</button>
          </RoleGate>
        </div>

        {toolUrls && (
          <div style={{ ...cardStyle, marginBottom: 12, display: 'grid', gap: 10 }}>
            <div>
              <div style={{ ...labelStyle, marginBottom: 4 }}>{t('oidcInitiationUrl')}</div>
              <code style={codeStyle}>{toolUrls.oidcInitiationUrl}</code>
            </div>
            <div>
              <div style={{ ...labelStyle, marginBottom: 4 }}>{t('targetLinkUri')}</div>
              <code style={codeStyle}>{toolUrls.targetLinkUri}</code>
            </div>
            <div>
              <div style={{ ...labelStyle, marginBottom: 4 }}>{t('publicJwkUrl')}</div>
              <code style={codeStyle}>{toolUrls.publicJwkUrl}</code>
            </div>
            <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: 0 }}>{t('toolUrlsHint')}</p>
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)' }}>{t('loading')}</div>
        ) : registrations.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
            {t('noRegistrations')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {registrations.map((registration) => (
              <div key={registration.id} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 600, color: 'var(--text-primary)' }}>{registration.label}</div>
                    <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>{registration.issuer}</div>
                    <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2 }}>
                      {t('deployments', { count: registration.deploymentIds.length })}
                    </div>
                  </div>
                  <span style={badge(registration.status === 'active' ? 'ok' : 'warn')}>
                    {registration.status === 'active' ? t('active') : t('disabled')}
                  </span>
                  <RoleGate capability="identity.manageProviders">
                    <button type="button" style={quietButton} onClick={() => openLti(registration)}>{t('edit')}</button>
                  </RoleGate>
                  <RoleGate capability="identity.manageProviders">
                    <button type="button" style={quietButton} onClick={() => void rotateKey(registration)}>{t('rotateKey')}</button>
                  </RoleGate>
                  <RoleGate capability="identity.manageProviders">
                    <button type="button" style={quietButton} onClick={() => void toggleRegistration(registration)}>
                      {registration.status === 'active' ? t('disable') : t('enable')}
                    </button>
                  </RoleGate>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── SSO editor ─────────────────────────────────────────────────── */}
      <SlideOutPanel
        open={ssoDraft != null}
        onClose={() => setSsoDraft(null)}
        title={ssoEditingId ? t('editConnection') : t('addConnection')}
      >
        {ssoDraft && (
          <div style={{ padding: 16 }}>
            {field(t('labelField'), ssoDraft.label, (v) => setSsoDraft({ ...ssoDraft, label: v }), t('labelHint'))}
            {field(t('issuerField'), ssoDraft.issuer, (v) => setSsoDraft({ ...ssoDraft, issuer: v }), t('issuerHint'))}
            {field(t('discoveryField'), ssoDraft.discoveryUrl, (v) => setSsoDraft({ ...ssoDraft, discoveryUrl: v }), t('discoveryHint'))}
            {field(t('authorizationField'), ssoDraft.authorizationUrl, (v) => setSsoDraft({ ...ssoDraft, authorizationUrl: v }))}
            {field(t('tokenField'), ssoDraft.tokenUrl, (v) => setSsoDraft({ ...ssoDraft, tokenUrl: v }))}
            {field(t('jwksField'), ssoDraft.jwksUrl, (v) => setSsoDraft({ ...ssoDraft, jwksUrl: v }))}
            {field(t('userinfoField'), ssoDraft.userinfoUrl, (v) => setSsoDraft({ ...ssoDraft, userinfoUrl: v }), t('userinfoHint'))}
            {field(t('clientIdField'), ssoDraft.clientId, (v) => setSsoDraft({ ...ssoDraft, clientId: v }))}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>{t('clientSecretField')}</label>
              <input
                type="password"
                style={inputStyle}
                value={ssoDraft.clientSecret}
                placeholder={ssoEditingId ? t('clientSecretUnchanged') : ''}
                onChange={(e) => setSsoDraft({ ...ssoDraft, clientSecret: e.target.value })}
              />
              <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('clientSecretHint')}</p>
            </div>
            {field(t('scopesField'), ssoDraft.scopes, (v) => setSsoDraft({ ...ssoDraft, scopes: v }), t('scopesHint'))}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>{t('defaultRoleField')}</label>
              <select
                style={{ ...inputStyle, background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                value={ssoDraft.defaultRole}
                onChange={(e) => setSsoDraft({ ...ssoDraft, defaultRole: e.target.value })}
              >
                {['viewer', 'developer', 'manager', 'owner'].map((role) => (
                  // Native options need their OWN opaque background and colour —
                  // a select that inherits only the wrapper's leaves the list
                  // unreadable in one of the two themes.
                  <option key={role} value={role} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                    {t(`role_${role}`)}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={ssoDraft.jitProvisioning}
                onChange={(e) => setSsoDraft({ ...ssoDraft, jitProvisioning: e.target.checked })}
              />
              <span>{t('jitLabel')}<br />
                <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('jitHint')}</span>
              </span>
            </label>
            <RoleGate capability="identity.manageProviders">
              <button type="button" style={primaryButton} disabled={saving} onClick={() => void saveSso()}>
                {saving ? t('saving') : t('save')}
              </button>
            </RoleGate>
          </div>
        )}
      </SlideOutPanel>

      {/* ── LTI editor ─────────────────────────────────────────────────── */}
      <SlideOutPanel
        open={ltiDraft != null}
        onClose={() => setLtiDraft(null)}
        title={ltiEditingId ? t('editRegistration') : t('addRegistration')}
      >
        {ltiDraft && (
          <div style={{ padding: 16 }}>
            <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 14px' }}>{t('registrationIntro')}</p>
            {field(t('labelField'), ltiDraft.label, (v) => setLtiDraft({ ...ltiDraft, label: v }), t('institutionHint'))}
            {field(t('platformIssuerField'), ltiDraft.issuer, (v) => setLtiDraft({ ...ltiDraft, issuer: v }), t('platformIssuerHint'))}
            {field(t('clientIdField'), ltiDraft.clientId, (v) => setLtiDraft({ ...ltiDraft, clientId: v }))}
            {field(t('deploymentIdsField'), ltiDraft.deploymentIds, (v) => setLtiDraft({ ...ltiDraft, deploymentIds: v }), t('deploymentIdsHint'))}
            {field(t('authLoginUrlField'), ltiDraft.authLoginUrl, (v) => setLtiDraft({ ...ltiDraft, authLoginUrl: v }))}
            {field(t('accessTokenUrlField'), ltiDraft.accessTokenUrl, (v) => setLtiDraft({ ...ltiDraft, accessTokenUrl: v }))}
            {field(t('keySetUrlField'), ltiDraft.keySetUrl, (v) => setLtiDraft({ ...ltiDraft, keySetUrl: v }))}
            <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '0 0 14px' }}>{t('keyGeneratedHint')}</p>
            <RoleGate capability="identity.manageProviders">
              <button type="button" style={primaryButton} disabled={saving} onClick={() => void saveLti()}>
                {saving ? t('saving') : t('save')}
              </button>
            </RoleGate>
          </div>
        )}
      </SlideOutPanel>
    </div>
  );
}
