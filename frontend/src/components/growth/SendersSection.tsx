'use client';

/** Who a campaign is from — a domain proved with a TXT record before sending. */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { growthApi, type SenderIdentity } from '@/lib/growthApi';
import { button, input, listItem, listReset, muted, spread, Row } from './growthStyles';

export function SendersSection() {
  const t = useTranslations('growth');
  const [senders, setSenders] = useState<SenderIdentity[]>([]);
  const [senderEmail, setSenderEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { senders: s } = await growthApi.listSenders();
    setSenders(s);
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
      {senders.length === 0 ? (
        <p style={{ ...muted, marginTop: 10 }}>{t('senders.empty')}</p>
      ) : (
        <ul style={listReset}>
          {senders.map((sender) => (
            <li key={sender.id} style={listItem}>
              <div style={spread}>
                <span style={{ overflowWrap: 'anywhere' }}>{sender.fromEmail}</span>
                <span style={{
                  ...muted,
                  color: sender.status === 'verified' ? 'var(--success-text)' : 'var(--warning-text)',
                }}>
                  {t(`senders.status.${sender.status === 'verified' ? 'verified' : 'pending'}`)}
                </span>
              </div>
              {sender.status !== 'verified' && (
                <>
                  <code style={{
                    display: 'block', overflowX: 'auto', whiteSpace: 'nowrap', marginTop: 6,
                    padding: '6px 8px', borderRadius: 'var(--radius-sm)', fontSize: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}>
                    {`TXT  ${sender.recordName}  →  ${sender.verifyToken}`}
                  </code>
                  <button type="button" style={{ ...button, marginTop: 8 }} disabled={busy}
                    onClick={() => run(() => growthApi.verifySender(sender.id), t('senders.checked'))}>
                    {t('senders.verify')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Row>
        <input style={input} value={senderEmail} disabled={busy} type="email"
          onChange={(e) => setSenderEmail(e.target.value)}
          placeholder={t('senders.emailPlaceholder')} aria-label={t('senders.emailLabel')} />
        <button type="button" style={button} disabled={busy || !senderEmail.trim()}
          onClick={() => run(
            () => growthApi.createSender({ fromEmail: senderEmail }).then(() => setSenderEmail('')),
            t('senders.created'),
          )}>
          {t('senders.add')}
        </button>
      </Row>
    </section>
  );
}
