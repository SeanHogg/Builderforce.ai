'use client';

/** Who a campaign sends to — fed automatically by site form submissions. */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { growthApi, type Audience } from '@/lib/growthApi';
import { button, input, listItem, listReset, muted, spread, Row } from './growthStyles';

export function AudiencesSection() {
  const t = useTranslations('growth');
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [audienceName, setAudienceName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { audiences: a } = await growthApi.listAudiences();
    setAudiences(a);
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
      {audiences.length === 0 ? (
        <p style={{ ...muted, marginTop: 10 }}>{t('audiences.empty')}</p>
      ) : (
        <ul style={listReset}>
          {audiences.map((audience) => (
            <li key={audience.id} style={{ ...listItem, ...spread }}>
              <span>{audience.name}</span>
              <span style={muted}>{t('audiences.memberCount', { count: audience.memberCount })}</span>
            </li>
          ))}
        </ul>
      )}
      <Row>
        <input style={input} value={audienceName} disabled={busy}
          onChange={(e) => setAudienceName(e.target.value)}
          placeholder={t('audiences.namePlaceholder')} aria-label={t('audiences.nameLabel')} />
        <button type="button" style={button} disabled={busy || !audienceName.trim()}
          onClick={() => run(
            () => growthApi.createAudience({ name: audienceName }).then(() => setAudienceName('')),
            t('audiences.created'),
          )}>
          {t('audiences.add')}
        </button>
      </Row>
    </section>
  );
}
