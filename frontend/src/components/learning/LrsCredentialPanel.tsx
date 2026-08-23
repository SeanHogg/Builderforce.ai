'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePermission } from '@/lib/rbac';
import { useConfirm } from '@/components/ConfirmProvider';
import { learningApi, xapiEndpoint, type LrsCredential } from '@/lib/learningApi';
import styles from './learning.module.css';

/**
 * The workspace's Learning Record Store credentials.
 *
 * Two directions, one list, because they are one fact seen from two ends (see
 * `api/src/application/learning/lrsCredentials.ts`): a key we ISSUED, that an
 * authoring tool sends us, and a key somebody else issued, that we SEND to their
 * corporate LRS.
 *
 * ── THIS ONE HIDES ITSELF ───────────────────────────────────────────────────
 * The house rule is disable-and-explain rather than hide, and this is the
 * deliberate exception: the endpoint listing is a credential inventory, and the
 * server answers 403 to a non-manager, so a <RoleGate variant="block"> would dim
 * a panel that is永 empty and raise an error toast behind it. It returns null
 * instead — from `usePermission`, never from a prop.
 *
 * ── THE SECRET IS SHOWN ONCE ────────────────────────────────────────────────
 * And it says so, because it is true: the server seals it and has no read path
 * back. The banner stays until the panel reloads rather than on a timer — a
 * disappearing secret is how somebody ends up with a key they cannot use.
 */
export function LrsCredentialPanel() {
  const t = useTranslations('learning');
  const confirm = useConfirm();
  const { allowed } = usePermission('learning.manage');

  const [credentials, setCredentials] = useState<LrsCredential[]>([]);
  const [label, setLabel] = useState('');
  const [issued, setIssued] = useState<{ key: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    learningApi.lrsCredentials()
      .then((res) => { setCredentials(res.credentials); setError(''); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('lrs.failed')));
  }, [t]);

  useEffect(() => {
    if (!allowed) return;
    load();
  }, [allowed, load]);

  const issue = () => {
    setBusy(true);
    learningApi.issueLrsCredential(label.trim())
      .then((res) => {
        setIssued({ key: res.credential.key, secret: res.secret });
        setLabel('');
        setError('');
        load();
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('lrs.issueFailed')))
      .finally(() => setBusy(false));
  };

  const revoke = async (credential: LrsCredential) => {
    const confirmed = await confirm({
      title: t('lrs.revokeTitle'),
      message: t('lrs.revokeConfirm', { label: credential.label }),
      destructive: true,
    });
    if (!confirmed) return;

    setBusy(true);
    learningApi.revokeLrsCredential(credential.id)
      .then(() => { setError(''); load(); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('lrs.revokeFailed')))
      .finally(() => setBusy(false));
  };

  if (!allowed) return null;

  return (
    <section className={styles.card} aria-labelledby="lrs-credentials-heading">
      <h3 id="lrs-credentials-heading" className={styles.cardTitle}>{t('lrs.title')}</h3>
      <p className={styles.cardHint}>{t('lrs.intro')}</p>

      <div className={styles.field}>
        <span className={styles.label}>{t('lrs.endpoint')}</span>
        <span className={styles.mono}>{xapiEndpoint()}</span>
      </div>

      {issued && (
        <div className={styles.secret}>
          <span className={styles.label}>{t('lrs.secretOnce')}</span>
          <span className={styles.secretValue}>{issued.key}</span>
          <span className={styles.secretValue}>{issued.secret}</span>
        </div>
      )}

      {credentials.length === 0 ? (
        <p className={styles.empty}>{t('lrs.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {credentials.map((credential) => (
            <div key={credential.id} className={`${styles.row} ${styles.rowStatic}`}>
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{credential.label}</span>
                <span className={styles.rowNote}>
                  {credential.direction === 'outbound' && credential.endpoint
                    ? credential.endpoint
                    : credential.key}
                </span>
              </span>
              <span className={styles.rowMeta}>
                <span className={styles.badge}>{t(`lrs.direction.${credential.direction}`)}</span>
                <span className={credential.status === 'connected' ? `${styles.badge} ${styles.badgeOk}` : `${styles.badge} ${styles.badgeWarn}`}>
                  {t(`lrs.status.${credential.status === 'connected' ? 'connected' : 'inactive'}`)}
                </span>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonDanger}`}
                  disabled={busy || credential.status === 'revoked'}
                  onClick={() => revoke(credential)}
                >
                  {t('lrs.revoke')}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="lrs-label">{t('lrs.newLabel')}</label>
        <input
          id="lrs-label"
          className={styles.input}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('lrs.newPlaceholder')}
        />
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={issue}
          disabled={busy || !label.trim()}
        >
          {busy ? t('common.saving') : t('lrs.issue')}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
