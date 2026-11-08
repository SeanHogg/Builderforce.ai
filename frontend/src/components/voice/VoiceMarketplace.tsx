'use client';

/**
 * VoiceMarketplace — browse the published voices and add one to your workspace.
 *
 * ONE component, two hosts: the web page (`/marketplace/voices`) and the VS Code
 * sidebar view mount THIS, over the same API client (`@/lib/voiceClones`) — there is
 * no second marketplace implementation. It reads only the public marketplace
 * projection (no embeddings, no reference keys). `POST /marketplace/:id/license`
 * licenses a FREE voice at once; for a PRICED one it returns the platform's hosted
 * checkout URL, which `canvasNavigate` opens (the web navigates; the editor hands it
 * to the external browser). The license is granted server-side by the redirect's
 * `/checkout/complete` (run below when the buyer lands back on the web page) or by
 * the webhook; the editor view picks it up on its next refresh.
 *
 * Layout is a single fluid column of cards, so a narrow sidebar needs no variant.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SectionEmpty, SectionLoading } from '@/components/ui/SectionState';
import { Surface } from '@/components/ui/Surface';
import { canvasNavigate, canvasWebOrigin } from '@/lib/canvasHost';
import { recordedFailure } from '@/lib/reportError';
import { formatMillicents } from '@/lib/canvasMoney';
import {
  acquireMarketplaceVoice,
  completeMarketplaceVoiceCheckout,
  listMarketplaceVoices,
  listVoiceClones,
  type VoiceClone,
} from '@/lib/voiceClones';

export function VoiceMarketplace() {
  const t = useTranslations('voice.marketplace');
  const [voices, setVoices] = useState<VoiceClone[] | null>(null);
  const [mine, setMine] = useState<ReadonlySet<number>>(new Set());
  const [search, setSearch] = useState('');
  const [failed, setFailed] = useState(false);
  const [acquiring, setAcquiring] = useState<number | null>(null);
  const [actionError, setActionError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [listed, owned] = await Promise.all([listMarketplaceVoices(), listVoiceClones().catch(recordedFailure('Reading my voice clones', [] as Awaited<ReturnType<typeof listVoiceClones>>))]);
      setFailed(false);
      setVoices(listed);
      setMine(new Set(owned.map((c) => c.id)));
    } catch {
      setFailed(true);
      setVoices([]);
    }
  }, []);

  const [notice, setNotice] = useState<string | null>(null);

  // THE RETURN LEG (web): the processor sends the buyer back with its session id.
  // Nothing was granted by the redirect itself — the server re-reads the session from
  // the processor before it licenses the voice (the webhook settles the same purchase).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const voiceId = Number(params.get('voice'));
    let outcome: Promise<string | null> = Promise.resolve(null);
    if (checkout) {
      // Clear first so a refresh cannot re-run a completed purchase.
      const clean = new URL(window.location.href);
      clean.searchParams.delete('checkout');
      clean.searchParams.delete('voice');
      window.history.replaceState({}, '', clean.toString());
      outcome = checkout === 'cancelled' || !Number.isInteger(voiceId)
        ? Promise.resolve(t('checkoutCancelled'))
        : completeMarketplaceVoiceCheckout(voiceId, checkout).then(
          (out) => t(out.status === 'revoked' ? 'licenseRevoked' : 'checkoutDone'),
          () => t('checkoutFailed'),
        );
    }
    // Everything that sets state runs after the answer, never synchronously in the effect.
    void outcome.then((message) => { if (message) setNotice(message); }).finally(() => void load());
  }, [load, t]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => (voices ?? []).filter((v) => !q || v.name.toLowerCase().includes(q) || (v.description ?? '').toLowerCase().includes(q)),
    [voices, q],
  );

  const acquire = async (id: number) => {
    setAcquiring(id);
    setActionError(false);
    setNotice(null);
    try {
      const out = await acquireMarketplaceVoice(id, `${canvasWebOrigin()}/marketplace/voices`);
      if ('status' in out) {
        setNotice(t('licenseRevoked'));
      } else if ('checkoutUrl' in out) {
        setNotice(t('checkoutOpened'));
        canvasNavigate(out.checkoutUrl);
      } else {
        setMine((prev) => new Set(prev).add(id));
      }
    } catch {
      setActionError(true);
    } finally {
      setAcquiring(null);
    }
  };

  return (
    <section style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-3)', minWidth: 0 }}>
      <header style={{ display: 'grid', gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('title')}</h2>
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('subtitle')}</p>
      </header>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <input
          className="ui-input"
          style={{ flex: '1 1 160px', minWidth: 0 }}
          type="search"
          value={search}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button size="sm" onClick={() => void load()}>{t('refresh')}</Button>
      </div>

      {voices === null && <SectionLoading label={t('loading')} />}
      {notice && <p role="status" style={{ margin: 0, fontSize: 'var(--font-size-small)' }}>{notice}</p>}
      {failed && <p role="alert" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--danger, var(--text-primary))' }}>{t('loadError')}</p>}
      {actionError && <p role="alert" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--danger, var(--text-primary))' }}>{t('acquireFailed')}</p>}
      {voices !== null && !failed && visible.length === 0 && (
        <SectionEmpty message={voices.length === 0 ? t('empty') : t('noMatch')} />
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
        {visible.map((v) => {
          const free = v.priceMillicents <= 0;
          const owned = mine.has(v.id);
          return (
            <li key={v.id} style={{ minWidth: 0 }}>
              <Surface padding="sm" style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>{v.name}</strong>
                  <Badge tone={free ? 'success' : 'neutral'}>
                    {free ? t('free') : t('price', { price: formatMillicents(v.priceMillicents) })}
                  </Badge>
                </div>
                {v.description && <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{v.description}</p>}
                {owned ? (
                  <Badge tone="info">{t('owned')}</Badge>
                ) : (
                  <Button size="sm" variant="primary" loading={acquiring === v.id} onClick={() => void acquire(v.id)}>
                    {acquiring === v.id ? t('acquiring') : free ? t('acquire') : t('buy')}
                  </Button>
                )}
              </Surface>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
