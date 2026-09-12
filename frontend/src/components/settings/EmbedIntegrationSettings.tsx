'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EMBED_CAPABILITIES, type EmbedCapability } from '@seanhogg/builderforce-embedded';
import { embedApi } from '@/lib/builderforceApi';
import { useAuth } from '@/lib/AuthContext';
import { usePermission } from '@/lib/rbac';
import { RoleGate } from '@/components/RoleGate';
import { EmbedConsentModal } from './EmbedConsentModal';
import { EmbedInstallSnippet } from './EmbedInstallSnippet';
import { EmbedSurfaceCatalog } from './EmbedSurfaceCatalog';
import { usePanelTask } from '@/hooks/usePanelTask';

/**
 * "BuilderForce surfaces": enablement for the embedded integration — turn on
 * embedding and pick which capability areas (Product / Agile / Security) host
 * apps may mount.
 *
 * It renders for EVERYONE. The catalog of surfaces and the install walkthrough
 * are the honest answer to "what is this?" for a signed-out visitor on the
 * public /embedded page and for a viewer-role member alike; only the CONTROLS
 * are gated, and they are gated the way every other capability in the app is —
 * shown inert behind {@link RoleGate}, which decides between "create an
 * account" and "requires Manager role" itself. The previous version returned
 * null for anyone who was not a signed-in owner/manager, which left the tab
 * labelled "BuilderForce surfaces" completely empty on the marketing page.
 *
 * Enabling for the first time (or after a consent-version bump) routes through
 * a consent panel; the acknowledged version is recorded server-side. Writes
 * are role-gated server-side too — `embed.manage` mirrors that gate.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};

const divider: React.CSSProperties = { marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' };

interface Persisted { enabled: boolean; capabilities: EmbedCapability[] }

export function EmbedIntegrationSettings() {
  const t = useTranslations('embedded.surfaces');
  const { tenantToken } = useAuth();
  const { allowed: canManage } = usePermission('embed.manage');
  // /api/embed/config is tenant-scoped; a manager's person-level session can
  // exist for a render before the workspace JWT is exchanged. Fetch only once
  // both are true — and show "loading" for that gap rather than an unfetched form.
  const connected = canManage && Boolean(tenantToken);

  const [enabled, setEnabled] = useState(false);
  const [capabilities, setCapabilities] = useState<EmbedCapability[]>([]);
  const [consentVersion, setConsentVersion] = useState<number | null>(null);
  const [requiredVersion, setRequiredVersion] = useState(0);
  const [persisted, setPersisted] = useState<Persisted>({ enabled: false, capabilities: [] });
  const [fetching, setFetching] = useState(false);
  const task = usePanelTask();
  // Stable — the config fetch keys on `connected`, never on `task`.
  const { fail } = task;
  const [consentOpen, setConsentOpen] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setFetching(true);
    embedApi
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        setEnabled(cfg.enabled);
        setCapabilities(cfg.capabilities);
        setPersisted({ enabled: cfg.enabled, capabilities: cfg.capabilities });
        setConsentVersion(cfg.consentVersion);
        setRequiredVersion(cfg.consentRequiredVersion);
      })
      .catch(() => { if (!cancelled) fail(t('loadError')); })
      .finally(() => !cancelled && setFetching(false));
    return () => {
      cancelled = true;
    };
  }, [connected, t, fail]);

  const loading = canManage && (!tenantToken || fetching);
  const needsConsent = enabled && consentVersion !== requiredVersion;

  const toggleCapability = (cap: EmbedCapability) => {
    task.clear();
    setCapabilities((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
  };

  // Persist the current form. `acknowledged` is forwarded only when the consent
  // panel was just confirmed, so the server stamps the consent version.
  const persist = async (acknowledged: boolean) => {
    const res = await task.run(
      () => embedApi.setConfig({ enabled, capabilities, consentAcknowledged: acknowledged }),
      { success: t('saved'), failure: t('saveError') },
    );
    if (res === undefined) return;
    setConsentVersion(res.consentVersion);
    setPersisted({ enabled: res.enabled, capabilities });
  };

  const onSave = () => {
    if (needsConsent) {
      setConsentOpen(true);
      return;
    }
    void persist(false);
  };

  const onConsent = () => {
    setConsentOpen(false);
    void persist(true);
  };

  // The snippet is real once embedding is on. Before that a manager sees only
  // the form (the snippet would be a lie about what mounts today), while a
  // visitor or non-manager gets the full walkthrough as a preview — what they
  // came to the tab to read.
  const showSnippet = connected ? persisted.enabled : true;

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
        {t('title')}
      </div>
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginBottom: 16 }}>
        {t('description')}
      </div>

      <EmbedSurfaceCatalog enabledCapabilities={persisted.enabled ? persisted.capabilities : []} />

      <RoleGate capability="embed.manage" variant="block" style={divider}>
        {loading ? (
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('loading')}</div>
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  task.clear();
                  setEnabled(e.target.checked);
                }}
              />
              <span style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>{t('enable')}</span>
            </label>

            <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('capabilities')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, opacity: enabled ? 1 : 0.5 }}>
              {EMBED_CAPABILITIES.map((cap) => (
                <label key={cap} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: enabled ? 'pointer' : 'default' }}>
                  <input
                    type="checkbox"
                    disabled={!enabled}
                    checked={capabilities.includes(cap)}
                    onChange={() => toggleCapability(cap)}
                  />
                  <span style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>{t(`capability.${cap}`)}</span>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={onSave}
                disabled={task.busy}
                style={{
                  padding: '6px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600,
                  background: 'var(--accent)', color: 'var(--text-on-accent)',
                  border: 'none', borderRadius: 'var(--radius-md)', cursor: task.busy ? 'default' : 'pointer',
                }}
              >
                {task.busy ? t('saving') : needsConsent ? t('reviewEnable') : t('save')}
              </button>
              {task.notice && <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--success-text)' }}>{task.notice} <Icon source="✓" size="1em" /></span>}
              {task.error && <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--error-text)' }} role="alert">{task.error}</span>}
            </div>
          </>
        )}
      </RoleGate>

      {showSnippet && (
        <div style={divider}>
          {!connected && (
            <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 12 }} role="note">{t('previewNote')}</div>
          )}
          <EmbedInstallSnippet capabilities={connected ? persisted.capabilities : [...EMBED_CAPABILITIES]} />
        </div>
      )}

      {consentOpen && (
        <EmbedConsentModal
          version={requiredVersion}
          onAgree={onConsent}
          onCancel={() => setConsentOpen(false)}
        />
      )}
    </div>
  );
}
