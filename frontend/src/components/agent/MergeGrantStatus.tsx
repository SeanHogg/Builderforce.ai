import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { runtimeApi, type MergeGrantView } from '@/lib/builderforceApi';
import { reportBackgroundFailure } from '@/lib/reportError';

/**
 * A run's "merge into main" grant (PRD 48 §4.6): who granted it, why, and where it stands —
 * pending (waiting for CI / the security scan), merged, held (with the sweep's CURRENT reason)
 * or voided (with why). Codes from the server, worded here. Renders nothing for a run without a
 * grant. Theme tokens only; wraps at 360px.
 */
export function MergeGrantStatus({ executionId, runStatus }: {
  executionId: number;
  /** The run's live status: the grant is re-read whenever it changes (a finished run binds or voids it). */
  runStatus?: string | null;
}) {
  const t = useTranslations('mergeGrant');
  // Keyed by the execution it was read for, so switching runs never shows the previous run's grant.
  const [loaded, setLoaded] = useState<{ executionId: number; grant: MergeGrantView | null } | null>(null);
  const grant = loaded?.executionId === executionId ? loaded.grant : null;

  useEffect(() => {
    let live = true;
    // Through a resolved promise, so even a synchronous throw from the client lands in the reporter below.
    Promise.resolve()
      .then(() => runtimeApi.mergeGrant(executionId))
      .then((r) => { if (live) setLoaded({ executionId, grant: r?.grant ?? null }); })
      // The run view still stands without the grant panel; the miss is reported, not swallowed.
      .catch((error: unknown) => void reportBackgroundFailure({
        title: 'MergeGrantStatusLoadFailed',
        message: error instanceof Error ? error.message : String(error),
        level: 'warning',
      }));
    return () => { live = false; };
  }, [executionId, runStatus]);

  if (!grant) return null;
  const tone = grant.status === 'merged'
    ? 'var(--success)'
    : grant.status === 'held' || grant.status === 'voided' ? 'var(--warning)' : 'var(--text-secondary)';
  const detail = grant.status === 'held' && grant.heldCode
    ? t(`held.${grant.heldCode}`)
    : grant.status === 'voided' && grant.voidCode ? t(`voided.${grant.voidCode}`) : null;
  return (
    <div
      style={{
        display: 'grid', gap: 4, marginBottom: 10, padding: '8px 10px', minWidth: 0,
        background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-small)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('statusTitle')}</span>
        <span style={{ fontWeight: 600, color: tone }}>{t(`status.${grant.status}`)}</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
        {t('grantedBy', { name: grant.grantedByName })}
      </div>
      <div style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{t('reasonShown', { reason: grant.reason })}</div>
      {detail && <div style={{ color: 'var(--warning)', overflowWrap: 'anywhere' }}>{detail}</div>}
    </div>
  );
}
