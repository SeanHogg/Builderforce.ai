'use client';

// The directive is REQUIRED here, not incidental to `PhoneConsole`. These cards
// are mounted from canvas surfaces and embedded apps as well as from the console,
// and several of those hosts are server components — a card that relies on an
// ancestor having already opened the client boundary cannot be dropped into one
// of them without an edit, which is the reuse contract this component is built to.
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/canvasMoney';
import { sendSms } from '@/lib/phoneApi';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

/**
 * Sending a message.
 *
 * ── THIS COMPONENT DOES NOT PRICE THE MESSAGE ────────────────────────────────
 * Deliberately, and it is the most tempting thing to add. Segment counting is a
 * real rule (GSM-7 at 160/153, UCS-2 at 70/67, and one emoji flips a body between
 * them), it already exists on the server as `smsSegments`, and re-implementing it
 * here would be a second copy of a BILLING rule in a second language, free to
 * drift from the one that actually charges. So the exact cost is reported after
 * the send, from the server's own answer, and before the send this shows the
 * character count and — when the body contains anything outside plain ASCII — a
 * WARNING that the cost may be higher. That warning is a hint, not a price, and
 * is worded as one.
 *
 * ── REFUSALS ARE EXPLAINED, NOT REPORTED ─────────────────────────────────────
 * `no_sending_number` and `insufficient_credit` need different actions from the
 * operator, so each gets its own sentence. A single "send failed" is how somebody
 * tops up a balance to fix a workspace that has no number.
 */
export function SmsComposer() {
  const t = useTranslations('phone');
  const locale = useLocale();
  const { overview, refresh } = usePhone();
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!overview?.plan.active) return null;

  // NOT the billing rule — see the docstring. Any non-ASCII character MAY push the
  // body onto the shorter unicode budget, which is worth flagging and is not worth
  // duplicating the server's exact arithmetic to compute.
  const mayCostMore = /[^ -~\n\r]/.test(body);

  const send = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const sent = await sendSms(to.trim(), body);
      setNotice(t('compose.sent', {
        segments: sent.segments,
        amount: formatCents(sent.costCents, { locale }),
      }));
      setBody('');
      await refresh();
    } catch (cause) {
      const reason = (cause as { reason?: string }).reason;
      setError(
        reason === 'no_sending_number' ? t('compose.noNumber')
          : reason === 'insufficient_credit' ? t('compose.noCredit')
            : cause instanceof Error ? cause.message : t('compose.failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${styles.card} ${styles.wide}`} aria-labelledby="phone-compose-heading">
      <h3 id="phone-compose-heading" className={styles.cardTitle}>{t('compose.title')}</h3>

      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="phone-sms-to">{t('compose.to')}</label>
          <input
            id="phone-sms-to" className={styles.input} type="tel" inputMode="tel"
            value={to} onChange={(e) => setTo(e.target.value)}
            placeholder={t('compose.toPlaceholder')}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="phone-sms-body">{t('compose.body')}</label>
          <textarea
            id="phone-sms-body" className={styles.textarea}
            value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={t('compose.bodyPlaceholder')}
          />
        </div>

        <p className={styles.cardHint}>
          {t('compose.characters', { count: body.length })}
          {mayCostMore && ` · ${t('compose.unicodeWarning')}`}
        </p>

        <button
          type="button" className={styles.button}
          disabled={busy || to.trim().length === 0 || body.length === 0}
          onClick={() => void send()}
        >
          {busy ? t('compose.sending') : t('compose.send')}
        </button>
      </div>

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
