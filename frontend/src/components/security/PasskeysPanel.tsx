'use client';

/**
 * A person's registered passkeys.
 *
 * This is personal account security — the same drawer as "which devices am I
 * signed in on" — so it sits inside {@link AccountSecurityPanel} rather than in
 * workspace governance. A passkey belongs to the human, not to the workspace:
 * enrolling one in a workspace they later leave would strand the credential.
 *
 * The whole surface is hidden when the browser cannot mint a passkey. An enrol
 * button that throws `NotSupportedError` teaches somebody that the feature is
 * broken, when in fact their browser simply does not have it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { passkeysApi, type Passkey } from '@/lib/builderforceApi';
import {
  createPasskeyCredential,
  hasPlatformAuthenticator,
  isPasskeyCancellation,
  isPasskeySupported,
} from '@/lib/passkeys';
import { useConfirm } from '@/components/ConfirmProvider';
import { useFormat } from '@/i18n/useFormat';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--font-size-body)',
  fontWeight: 700,
  color: 'var(--text-primary)',
};

const primaryButton: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

const quietButton: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

export default function PasskeysPanel() {
  const t = useTranslations('passkeys');
  const fmt = useFormat();
  const confirm = useConfirm();

  const [supported, setSupported] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    const available = isPasskeySupported();
    setSupported(available);
    if (!available) {
      setLoading(false);
      return;
    }
    void hasPlatformAuthenticator().then(setPlatform);
    passkeysApi.list()
      .then(setPasskeys)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const enrol = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const options = await passkeysApi.registerOptions();
      const credential = await createPasskeyCredential(options);
      const created = await passkeysApi.register(credential);
      setPasskeys((prev) => [...prev, created]);
    } catch (e) {
      // Dismissing the system prompt is a choice, not a failure.
      if (!isPasskeyCancellation(e)) setError(e instanceof Error ? e.message : t('addFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const remove = useCallback(async (passkey: Passkey) => {
    const ok = await confirm({
      title: t('removeTitle'),
      message: t('removeMessage', { name: passkey.name }),
      confirmLabel: t('removeConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await passkeysApi.remove(passkey.id);
      setPasskeys((prev) => prev.filter((p) => p.id !== passkey.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('removeFailed'));
    }
  }, [confirm, t]);

  const commitRename = useCallback(async (passkey: Passkey) => {
    const name = draftName.trim();
    setRenamingId(null);
    if (!name || name === passkey.name) return;
    try {
      const updated = await passkeysApi.rename(passkey.id, name);
      setPasskeys((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('renameFailed'));
    }
  }, [draftName, t]);

  if (supported === false) {
    return (
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ ...sectionTitle, marginBottom: 4 }}>{t('title')}</div>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('unsupported')}</p>
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...sectionTitle, marginBottom: 4 }}>{t('title')}</div>
          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 0, marginBottom: 14, maxWidth: '62ch' }}>
            {platform ? t('subtitlePlatform') : t('subtitle')}
          </p>
        </div>
        <button type="button" onClick={enrol} disabled={busy || supported === null} style={primaryButton}>
          {busy ? t('adding') : t('add')}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--coral-bright)', marginBottom: 10 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : passkeys.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {passkeys.map((passkey) => (
            <div
              key={passkey.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, flexWrap: 'wrap',
                padding: '10px 14px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {renamingId === passkey.id ? (
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => void commitRename(passkey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(passkey);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    aria-label={t('nameLabel')}
                    style={{
                      width: '100%', maxWidth: 260, padding: '4px 8px', fontSize: 'var(--font-size-small)',
                      background: 'var(--bg-base)', color: 'var(--text-primary)',
                      border: '1px solid var(--border-strong, var(--border-subtle))',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {passkey.name}
                    {passkey.backedUp && (
                      <span style={{ marginLeft: 8, fontSize: 'var(--font-size-field-label)', fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-success-soft, rgba(34,197,94,0.12))', color: 'var(--success-text, rgba(34,197,94,0.9))' }}>
                        {t('synced')}
                      </span>
                    )}
                    {passkey.signCountRegressed && (
                      <span style={{ marginLeft: 8, fontSize: 'var(--font-size-field-label)', fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-warning-soft, rgba(234,179,8,0.14))', color: 'var(--warning-text, rgba(234,179,8,0.95))' }} title={t('counterWarningHint')}>
                        {t('counterWarning')}
                      </span>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 3 }}>
                  {t('added', { date: fmt.dateTime(passkey.createdAt) })}
                  {passkey.lastUsedAt
                    ? ` · ${t('lastUsed', { date: fmt.dateTime(passkey.lastUsedAt) })}`
                    : ` · ${t('neverUsed')}`}
                  {passkey.transports.length > 0 && ` · ${passkey.transports.join(', ')}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => { setRenamingId(passkey.id); setDraftName(passkey.name); }}
                  style={quietButton}
                >
                  {t('rename')}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(passkey)}
                  style={{ ...quietButton, color: 'var(--coral-bright)' }}
                >
                  {t('remove')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
