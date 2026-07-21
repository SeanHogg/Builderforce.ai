'use client';

/**
 * Settings surface for the two things that decide what lands in a user's inbox:
 * the LANGUAGE their email is written in, and CONSENT for each kind of
 * non-transactional mail.
 *
 * The framing here is deliberate and load-bearing. Account & security mail
 * (sign-in links, verification codes, invitations, password resets) is
 * TRANSACTIONAL: it is never suppressed, so it is described as always-on rather
 * than presented as a toggle the user can flip and then be confused about. Only
 * lifecycle mail gets switches. That mirrors exactly what the API enforces —
 * `sendTransactionalEmail` never consults consent, `sendLifecycleEmail` always does.
 *
 * The global unsubscribe (taken from a mail footer, off-session) is shown as a
 * banner rather than a fourth toggle: it OVERRIDES the categories, so rendering it
 * inline with them would imply it is peer-level and let a category toggle appear
 * to undo it. Turning it back on is an explicit, confirmed action.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { LOCALE_LABELS, LOCALES, type Locale } from '@/i18n/config';
import {
  emailPreferencesApi,
  LIFECYCLE_TOGGLES,
  type EmailPreferences,
  type LifecycleToggle,
} from '@/lib/emailPreferencesApi';

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

const mutedStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
};

/**
 * Accessible switch row. `flex-start` + a wrapping label column is what makes this
 * read correctly on a narrow screen: the control stays put and the help text
 * reflows beneath the label instead of squeezing the switch off the row.
 */
function ToggleRow({ label, help, checked, disabled, onChange }: {
  label: string; help: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0',
      cursor: disabled ? 'default' : 'pointer',
    }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          flexShrink: 0, marginTop: 2, width: 40, height: 22, borderRadius: 999, border: 'none',
          position: 'relative', cursor: disabled ? 'default' : 'pointer', transition: 'background 0.2s',
          background: checked ? 'var(--accent)' : 'var(--border-subtle)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18,
          borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
        }} />
      </button>
      <span>
        <span style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ display: 'block', ...mutedStyle }}>{help}</span>
      </span>
    </label>
  );
}

export default function EmailPreferencesCard() {
  const t = useTranslations('settings');
  const confirm = useConfirm();

  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [locale, setLocale] = useState<Locale | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    emailPreferencesApi.get()
      .then((res) => { setPrefs(res.preferences); setLocale(res.locale); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const patch = async (
    body: Partial<Record<LifecycleToggle, boolean>> & { locale?: Locale; resubscribe?: boolean },
  ) => {
    setBusy(true);
    setError(null);
    // Optimistic: a switch that lags behind the finger feels broken. Reconciled
    // from the server response, and rolled back by `load()` on failure.
    const previous = prefs;
    if (prefs) setPrefs({ ...prefs, ...body, ...(body.resubscribe ? { unsubscribedAll: false } : {}) });
    try {
      const { preferences } = await emailPreferencesApi.update(body);
      setPrefs(preferences);
      if (body.locale) setLocale(body.locale);
    } catch (e) {
      setPrefs(previous);
      setError(e instanceof Error ? e.message : t('emailPrefs.error'));
    } finally {
      setBusy(false);
    }
  };

  const resubscribe = async () => {
    // Re-enabling someone's own mail is a consent action, so make it deliberate.
    // Not destructive — hence `destructive: false`, which keeps the neutral button.
    const ok = await confirm({
      title: t('emailPrefs.resubscribeTitle'),
      message: t('emailPrefs.resubscribeConfirm'),
      confirmLabel: t('emailPrefs.resubscribeCta'),
      destructive: false,
    });
    if (ok) await patch({ resubscribe: true });
  };

  const HELP: Record<LifecycleToggle, { label: string; help: string }> = {
    productUpdates: { label: t('emailPrefs.productUpdates'), help: t('emailPrefs.productUpdatesHelp') },
    onboardingTips: { label: t('emailPrefs.onboardingTips'), help: t('emailPrefs.onboardingTipsHelp') },
    digests:        { label: t('emailPrefs.digests'),        help: t('emailPrefs.digestsHelp') },
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 4,
      }}>
        <div style={sectionTitle}>{t('emailPrefs.title')}</div>
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
          }}
        >
          {t('emailPrefs.whatWeSend')} →
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Email language. Separate from the UI LanguageSwitcher on purpose: the
              app language is a browser preference, this is what we WRITE to you in
              — a user can read the UI in English and want mail in German. */}
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, flexWrap: 'wrap',
            }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                {t('emailPrefs.language')}
              </span>
              <select
                value={locale ?? ''}
                disabled={busy}
                onChange={(e) => { if (e.target.value) void patch({ locale: e.target.value as Locale }); }}
                style={{
                  padding: '7px 10px', fontSize: 13, borderRadius: 8,
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', cursor: busy ? 'wait' : 'pointer',
                  minWidth: 160,
                }}
              >
                {/* Native <option> needs its own opaque colours — the OS popup does
                    not inherit the theme variables from the <select>. */}
                {locale === null && (
                  <option value="" style={{ background: '#ffffff', color: '#111827' }}>
                    {t('emailPrefs.languageAuto')}
                  </option>
                )}
                {LOCALES.map((l) => (
                  <option key={l} value={l} style={{ background: '#ffffff', color: '#111827' }}>
                    {LOCALE_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>
            <p style={{ ...mutedStyle, margin: '4px 0 0' }}>{t('emailPrefs.languageHelp')}</p>
          </div>

          {/* Global opt-out banner — overrides everything below, so it is stated
              once, above them, rather than sitting among them as a peer toggle. */}
          {prefs?.unsubscribedAll && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
              padding: 12, borderRadius: 10,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  {t('emailPrefs.unsubscribedTitle')}
                </div>
                <div style={mutedStyle}>{t('emailPrefs.unsubscribedBody')}</div>
              </div>
              <button
                type="button"
                onClick={() => void resubscribe()}
                disabled={busy}
                style={{
                  padding: '7px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8,
                  border: '1px solid var(--border-subtle)', cursor: busy ? 'wait' : 'pointer',
                  background: 'var(--surface-interactive)', color: 'var(--text-primary)',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {t('emailPrefs.resubscribeCta')}
              </button>
            </div>
          )}

          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 2 }}>
              {t('emailPrefs.optionalTitle')}
            </div>
            <p style={{ ...mutedStyle, margin: '0 0 4px' }}>{t('emailPrefs.optionalHelp')}</p>
            {LIFECYCLE_TOGGLES.map((key) => (
              <ToggleRow
                key={key}
                label={HELP[key].label}
                help={HELP[key].help}
                // A global opt-out wins, so the switches read as off AND are
                // disabled — otherwise a user could flip one and wonder why no
                // mail arrives.
                checked={!prefs?.unsubscribedAll && !!prefs?.[key]}
                disabled={busy || !!prefs?.unsubscribedAll}
                onChange={(v) => void patch({ [key]: v })}
              />
            ))}
          </div>

          <p style={{ ...mutedStyle, margin: 0 }}>{t('emailPrefs.transactionalNote')}</p>
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: 'var(--coral-bright)', margin: '12px 0 0' }}>{error}</p>}

      {/* Detail surface = SlideOutPanel, never a modal (modals are for terminal /
          destructive approvals only). */}
      <SlideOutPanel open={detailOpen} onClose={() => setDetailOpen(false)} title={t('emailPrefs.whatWeSend')}>
        <div style={{ display: 'grid', gap: 20, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <section>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
              {t('emailPrefs.alwaysOnTitle')}
            </h3>
            <p style={{ margin: '0 0 8px' }}>{t('emailPrefs.alwaysOnBody')}</p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {['signIn', 'verification', 'invites', 'security'].map((k) => (
                <li key={k} style={{ marginBottom: 4 }}>{t(`emailPrefs.alwaysOn.${k}`)}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
              {t('emailPrefs.optionalTitle')}
            </h3>
            <p style={{ margin: '0 0 8px' }}>{t('emailPrefs.optionalDetail')}</p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {LIFECYCLE_TOGGLES.map((key) => (
                <li key={key} style={{ marginBottom: 4 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{HELP[key].label}</strong> — {HELP[key].help}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
              {t('emailPrefs.languageTitle')}
            </h3>
            <p style={{ margin: 0 }}>{t('emailPrefs.languageDetail')}</p>
          </section>
        </div>
      </SlideOutPanel>
    </div>
  );
}
