'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { learningApi } from '@/lib/learningApi';
import styles from './learning.module.css';

/**
 * Point this LRS at somebody else's.
 *
 * Separate from `LrsCredentialPanel` because it is the opposite act with the
 * opposite risk: that panel MINTS a credential we control, this one accepts one a
 * customer pastes in and starts sending their learners' records to a third party.
 * Four fields, one call, and no shared state with the listing beyond the reload
 * it asks for — which is the whole reason it can sit inside that panel without
 * making it the file everyone has to edit.
 *
 * The endpoint is validated on the server (absolute https, no query, no
 * fragment) and the refusal is rendered rather than pre-empted, so the rule lives
 * in one place.
 */
export function LrsForwardingTargetForm({ onAdded }: { onAdded?: () => void }) {
  const t = useTranslations('learning');

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const complete = Boolean(endpoint.trim() && key.trim() && secret.trim());

  const submit = () => {
    setBusy(true);
    learningApi.addLrsTarget({
      label: label.trim(), endpoint: endpoint.trim(), key: key.trim(), secret: secret.trim(),
    })
      .then(() => {
        setLabel(''); setEndpoint(''); setKey(''); setSecret('');
        setError(''); setOpen(false);
        onAdded?.();
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('target.failed')))
      .finally(() => setBusy(false));
  };

  if (!open) {
    return (
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => setOpen(true)}>
          {t('target.open')}
        </button>
      </div>
    );
  }

  return (
    <div>
      <h4 className={styles.cardTitle}>{t('target.title')}</h4>
      <p className={styles.cardHint}>{t('target.intro')}</p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="target-label">{t('target.label')}</label>
        <input
          id="target-label" className={styles.input}
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder={t('target.labelPlaceholder')}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="target-endpoint">{t('target.endpoint')}</label>
        <input
          id="target-endpoint" className={styles.input} inputMode="url"
          value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
          placeholder={t('target.endpointPlaceholder')}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="target-key">{t('target.key')}</label>
        <input
          id="target-key" className={styles.input} autoComplete="off"
          value={key} onChange={(e) => setKey(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="target-secret">{t('target.secret')}</label>
        <input
          id="target-secret" className={styles.input} type="password" autoComplete="off"
          value={secret} onChange={(e) => setSecret(e.target.value)}
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button" className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={submit} disabled={busy || !complete}
        >
          {busy ? t('common.saving') : t('target.save')}
        </button>
        <button type="button" className={styles.button} onClick={() => setOpen(false)} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
