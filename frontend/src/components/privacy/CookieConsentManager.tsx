'use client';

import { useEffect, useState } from 'react';

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

/** Optional tracking defaults off. GPC overrides a stored opt-in. */
export function CookieConsentManager() {
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
    const open = () => { setCustomizing(true); setConsent(null); };
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
    <section role="dialog" aria-modal="false" aria-labelledby="cookie-title" style={{ position: 'fixed', zIndex: 10000, inset: 'auto 16px 16px 16px', maxWidth: 620, margin: 'auto', padding: 18, borderRadius: 14, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', boxShadow: '0 16px 48px rgba(0,0,0,.45)' }}>
      <h2 id="cookie-title" style={{ margin: '0 0 8px', fontSize: 18 }}>Your privacy choices</h2>
      <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>Necessary storage runs the service. Analytics is optional, off by default, and never used to sell your information, chats, or ideas. {gpc && <strong>Your Global Privacy Control signal is active, so analytics remains off.</strong>}</p>
      {customizing && <label style={{ display: 'flex', gap: 9, marginBottom: 12 }}><input type="checkbox" checked={analytics} disabled={gpc} onChange={(e) => setAnalytics(e.target.checked)} /> Allow privacy-limited analytics</label>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" onClick={() => save(false)}>Reject optional</button>
        <button type="button" onClick={() => setCustomizing(true)}>Customize</button>
        <button type="button" disabled={gpc} onClick={() => save(customizing ? analytics : true)}>Accept analytics</button>
        <a href="/legal/cookies">Cookie policy</a>
      </div>
    </section>
  );
}
