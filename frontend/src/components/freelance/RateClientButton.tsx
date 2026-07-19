'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { reviewClient } from '@/lib/freelancerApi';

/**
 * Freelancer-side "Rate client" control — the reverse review direction. Self-contained
 * (owns its own panel + form + submit), so any engagement row can drop it in without
 * threading state. Builds the client's two-way reputation shown on job postings.
 */
export function RateClientButton({ engagementId, clientName }: { engagementId: string; clientName?: string | null }) {
  const t = useTranslations('rateClient');
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [again, setAgain] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await reviewClient(engagementId, rating, comment || undefined, again); setDone(true); setTimeout(() => setOpen(false), 900); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', color: 'var(--coral-bright, #f4726e)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>
        ★ {t('rate')}
      </button>
      <SlideOutPanel open={open} onClose={() => setOpen(false)} title={clientName ? t('titleNamed', { name: clientName }) : t('title')} width="min(420px, 96vw)">
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {done ? (
            <div style={{ color: 'rgba(34,197,94,0.95)', fontSize: 14, fontWeight: 600 }}>{t('thanks')} ✓</div>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{t('blurb')}</p>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n)} aria-label={String(n)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 26, color: n <= rating ? 'var(--warning-fg, #f59e0b)' : 'var(--border-subtle)' }}>★</button>
                ))}
              </div>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('commentPlaceholder')}
                style={{ minHeight: 72, resize: 'vertical', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
                {t('wouldWorkAgain')}
              </label>
              {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 12 }}>{error}</div>}
              <button type="button" onClick={() => void submit()} disabled={busy}
                style={{ alignSelf: 'flex-start', padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--coral-bright, #f4726e)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? t('submitting') : t('submit')}
              </button>
            </>
          )}
        </div>
      </SlideOutPanel>
    </>
  );
}
