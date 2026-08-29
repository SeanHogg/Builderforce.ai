'use client';

/** Logos and images an email can actually load — templates using `{{logo}}` pick
 *  up the most recently uploaded or generated one. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { growthApi, type MarketingAsset } from '@/lib/growthApi';
import { button, input, muted, Row } from './growthStyles';

export function BrandSection() {
  const t = useTranslations('growth');
  const confirm = useConfirm();
  const [assets, setAssets] = useState<MarketingAsset[]>([]);
  const [logoBrief, setLogoBrief] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const { assets: a } = await growthApi.listAssets();
    setAssets(a);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (op: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await op();
      setNotice(successMessage);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }, [reload, t]);

  return (
    <section>
      {notice && <p role="status" style={{ ...muted, color: 'var(--success-text)' }}>{notice}</p>}
      {error && <p role="alert" style={{ ...muted, color: 'var(--danger-text)' }}>{error}</p>}
      {assets.length === 0 ? (
        <p style={{ ...muted, marginTop: 10 }}>{t('brand.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {assets.map((asset) => (
            <li key={asset.id} style={{
              display: 'grid', gap: 4, justifyItems: 'center', width: '6.5rem',
              padding: 8, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- an asset
                  URL is an absolute, session-less R2-backed URL on an origin
                  the Next image optimizer is not configured for. */}
              <img src={asset.url} alt={asset.name} style={{ maxWidth: '100%', maxHeight: 44, objectFit: 'contain' }} />
              <span style={{ ...muted, fontSize: 11, textAlign: 'center', overflowWrap: 'anywhere' }}>{asset.name}</span>
              <button type="button" style={{ ...button, padding: '2px 8px', minHeight: 0, fontSize: 11 }}
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({ message: t('brand.confirmDelete', { name: asset.name }) });
                  if (!ok) return;
                  await run(() => growthApi.deleteAsset(asset.id), t('brand.deleted'));
                }}>
                {t('brand.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Row>
        <input ref={uploadRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset the input so re-picking the same file fires `change` again.
            e.target.value = '';
            if (file) void run(() => growthApi.uploadAsset(file, 'logo'), t('brand.uploaded'));
          }} />
        <button type="button" style={button} disabled={busy} onClick={() => uploadRef.current?.click()}>
          {t('brand.upload')}
        </button>
      </Row>
      <Row>
        <input style={input} value={logoBrief} disabled={busy}
          onChange={(e) => setLogoBrief(e.target.value)}
          placeholder={t('brand.generatePlaceholder')} aria-label={t('brand.generateLabel')} />
        <button type="button" style={button} disabled={busy || !logoBrief.trim()}
          onClick={() => run(
            () => growthApi.generateLogo({ description: logoBrief }).then(() => setLogoBrief('')),
            t('brand.generated'),
          )}>
          {t('brand.generate')}
        </button>
      </Row>
    </section>
  );
}
