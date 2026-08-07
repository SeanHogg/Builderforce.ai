'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type Consent = { version: 1; analytics: boolean; marketing: boolean; gpc: boolean; updatedAt: string };
const KEY = 'builderforce-consent-v1';
const GTM_ID = 'GTM-5Q488PKG';

function hasGpc(): boolean {
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

function readConsent(): Consent | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Consent | null; } catch { return null; }
}

function enableAnalytics() {
  if (document.getElementById('builderforce-gtm')) return;
  const script = document.createElement('script');
  script.id = 'builderforce-gtm';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(script);
  const layer = ((window as unknown as { dataLayer?: unknown[] }).dataLayer ??= []);
  layer.push({ 'gtm.start': Date.now(), event: 'gtm.js', consent_source: 'explicit_opt_in' });
}

/** A compact, non-modal consent surface. Optional tracking defaults off and a
 * browser GPC signal always overrides an older opt-in. */
export function CookieConsentManager() {
  const t = useTranslations('cookieConsent');
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined);
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    const gpc = hasGpc();
    const saved = readConsent();
    const effective = saved ? { ...saved, analytics: gpc ? false : saved.analytics, marketing: gpc ? false : saved.marketing, gpc } : null;
    if (effective && JSON.stringify(effective) !== JSON.stringify(saved)) localStorage.setItem(KEY, JSON.stringify(effective));
    setConsent(effective);
    setAnalytics(effective?.analytics ?? false);
    if (effective?.analytics) enableAnalytics();
  }, []);

  useEffect(() => {
    const open = () => {
      const saved = readConsent();
      setAnalytics(saved?.analytics ?? false);
      setCustomizing(true);
      setConsent(null);
    };
    window.addEventListener('builderforce:cookie-preferences', open);
    return () => window.removeEventListener('builderforce:cookie-preferences', open);
  }, []);

  const save = (allowAnalytics: boolean) => {
    const gpc = hasGpc();
    const next: Consent = { version: 1, analytics: gpc ? false : allowAnalytics, marketing: false, gpc, updatedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(next));
    setConsent(next);
    setCustomizing(false);
    if (next.analytics) enableAnalytics();
  };

  if (consent === undefined || (consent && !customizing)) return null;
  const gpc = typeof navigator !== 'undefined' && hasGpc();

  return (
    <aside className="privacy-choice-card" aria-labelledby="privacy-choice-title" aria-live="polite">
      <div className="privacy-choice-heading">
        <span className="privacy-choice-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Z" />
            <path d="m9.2 12 1.8 1.8 3.8-4" />
          </svg>
        </span>
        <div>
          <h2 id="privacy-choice-title">{t('title')}</h2>
          <span>{t('subtitle')}</span>
        </div>
        {gpc && <span className="privacy-choice-gpc">{t('gpcBadge')}</span>}
      </div>

      {customizing ? (
        <div className="privacy-choice-settings">
          <div className="privacy-choice-setting">
            <div>
              <strong>{t('necessaryLabel')}</strong>
              <span>{t('necessaryDesc')}</span>
            </div>
            <span className="privacy-choice-always">{t('alwaysOn')}</span>
          </div>
          <label className="privacy-choice-setting">
            <div>
              <strong>{t('analyticsLabel')}</strong>
              <span>{t('analyticsDesc')}</span>
            </div>
            <input className="privacy-choice-toggle" type="checkbox" role="switch" checked={analytics} disabled={gpc} onChange={(e) => setAnalytics(e.target.checked)} aria-label={t('allowAnalytics')} />
          </label>
          {gpc && <p className="privacy-choice-gpc-note">{t('gpcNote')}</p>}
        </div>
      ) : (
        <p className="privacy-choice-copy">{t('body')}</p>
      )}

      <div className="privacy-choice-actions">
        {customizing ? (
          <>
            <button type="button" className="privacy-choice-button privacy-choice-secondary" onClick={() => save(false)}>{t('necessaryOnly')}</button>
            <button type="button" className="privacy-choice-button privacy-choice-primary" onClick={() => save(analytics)}>{t('saveChoices')}</button>
          </>
        ) : (
          <>
            <button type="button" className="privacy-choice-button privacy-choice-secondary" onClick={() => save(false)}>{t('necessaryOnly')}</button>
            <button type="button" className="privacy-choice-button privacy-choice-primary" disabled={gpc} onClick={() => save(true)}>{t('allowAnalytics')}</button>
          </>
        )}
      </div>

      <div className="privacy-choice-footer">
        {!customizing && <button type="button" onClick={() => setCustomizing(true)}>{t('customize')}</button>}
        {customizing && <button type="button" onClick={() => setCustomizing(false)}>{t('back')}</button>}
        <span aria-hidden="true">·</span>
        <Link href="/legal/cookies">{t('cookiePolicy')}</Link>
      </div>
    </aside>
  );
}
