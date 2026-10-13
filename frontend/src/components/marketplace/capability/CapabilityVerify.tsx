import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplaySiteVerifyDto } from '@builderforce/interaction-contract';
import { usePolledResource } from '@/hooks/usePolledResource';
import { replaySitesApi } from '@/lib/replaySitesApi';
import styles from './capability.module.css';

/** The live install checks, in the order an install passes them (§4.2 step 6). */
export const VERIFY_CHECKS: ReadonlyArray<{
  id: 'loader' | 'origin' | 'firstEvent' | 'firstRecording';
  passed: (v: ReplaySiteVerifyDto) => boolean;
  /** Required for the site to count as installed; the first recording can take a while. */
  required: boolean;
}> = [
  { id: 'loader', passed: (v) => v.scriptSeen, required: true },
  { id: 'origin', passed: (v) => v.originOk, required: true },
  { id: 'firstEvent', passed: (v) => v.firstEventAt != null, required: true },
  { id: 'firstRecording', passed: (v) => v.firstRecordingId != null, required: false },
];

export const VERIFY_POLL_MS = 5_000;

export function isInstalled(v: ReplaySiteVerifyDto | null): boolean {
  return !!v && VERIFY_CHECKS.every((check) => !check.required || check.passed(v));
}

/**
 * Polls the site's install checks every 5 s while the tab is visible (the one
 * polling hook), shows each check, and names the check that stopped the install
 * with what to do about it. Stops once every check passes.
 */
export function CapabilityVerify({ siteId, onResult }: {
  siteId: string;
  onResult?: (verify: ReplaySiteVerifyDto) => void;
}) {
  const t = useTranslations('marketplace.capability.verify');
  const [verify, setVerify] = useState<ReplaySiteVerifyDto | null>(null);
  const [failed, setFailed] = useState(false);
  const done = verify !== null && VERIFY_CHECKS.every((check) => check.passed(verify));

  usePolledResource(async (signal) => {
    try {
      const next = await replaySitesApi.verify(siteId);
      if (signal.aborted) return;
      setFailed(false);
      setVerify(next);
      onResult?.(next);
    } catch (cause) {
      if (!signal.aborted) setFailed(true);
      throw cause;
    }
  }, { intervalMs: VERIFY_POLL_MS, enabled: !done, restartKey: siteId });

  const stopped = verify ? VERIFY_CHECKS.find((check) => !check.passed(verify)) ?? null : null;

  return (
    <div className={styles.stack} data-testid="capability-verify" aria-live="polite">
      <ul className={styles.checks}>
        {VERIFY_CHECKS.map((check) => {
          const ok = verify ? check.passed(verify) : false;
          return (
            <li key={check.id} className={styles.check} data-check={check.id} data-ok={ok ? 'true' : 'false'}>
              <span className={`${styles.checkMark} ${ok ? styles.checkOk : styles.checkWait}`} aria-hidden="true">{ok ? '✓' : '…'}</span>
              <span>{t(`checks.${check.id}.label` as never)}</span>
              <span className="sr-only">{ok ? t('passed') : t('waiting')}</span>
            </li>
          );
        })}
      </ul>
      {failed && <p className={styles.error} role="alert">{t('unreachable')}</p>}
      {stopped && (
        <p className={styles.body} data-testid="verify-stopped">
          {t('stoppedAt', { step: t(`checks.${stopped.id}.label` as never) })} {t(`checks.${stopped.id}.fix` as never)}
        </p>
      )}
      {done && <p className={styles.body}>{t('allPassed')}</p>}
    </div>
  );
}
