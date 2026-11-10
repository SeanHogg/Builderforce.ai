import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { faultMessage } from '@/lib/apiClient';
import { downloadBlob } from '@/lib/download';
import {
  executeDsr, fetchDsrExport, markDsrDelivered, planDsr, verifyDsrIdentity,
  type DsrDisposition, type DsrExecutionResult, type DsrPlan,
} from '@/lib/governanceDevsecopsApi';
import { useConfirm } from '@/components/ConfirmProvider';

/**
 * Execute a data subject request for THIS segment (PRD 08 §10). What execution will do is the API's
 * answer (`/dsr/:id/plan`), not re-derived here. Afterwards it says what was done - including the
 * stores it could not cover - and, for an access / portability request, offers the prepared export for
 * download. The request is never marked completed by executing: a manager confirms delivery with
 * "Mark delivered", a separate audited action.
 */
export interface DsrExecutePanelProps {
  requestId: string;
  /** Who the request is about (e.g. their email), named in the irreversible-erase confirmation. */
  subject?: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

const GOVERNANCE_WRITE_CAP = 'policies.manage' as const;

/** Dispositions that destroy data and cannot be undone: executing one is confirmed first. */
const IRREVERSIBLE: ReadonlySet<DsrDisposition> = new Set<DsrDisposition>(['suppress_and_erase']);

const counts = (m: Record<string, number>): string =>
  Object.entries(m).map(([store, n]) => `${store}: ${n}`).join(', ');

export function DsrExecutePanel({ requestId, subject, open, onClose, onDone }: DsrExecutePanelProps) {
  const t = useTranslations('governance.dsrExecute');
  const confirm = useConfirm();
  const [plan, setPlan] = useState<DsrPlan | null>(null);
  const [busy, setBusy] = useState<'run' | 'deliver' | 'download' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DsrExecutionResult | null>(null);
  // The request on screen now: an answer for any other request arrived too late and is dropped.
  const shown = useRef(requestId);
  const acting = useRef(false);

  useEffect(() => {
    shown.current = requestId;
    if (!open) return;
    // A different request starts from nothing: the previous one's plan (e.g. `verified`) must
    // never enable Run for this one while its own plan loads.
    setPlan(null);
    setResult(null);
    setError(null);
    let current = true;
    planDsr(requestId).then(
      (next) => { if (current) setPlan(next); },
      (e: unknown) => { if (current) setError(faultMessage(e, t('error')) ?? t('error')); },
    );
    return () => { current = false; };
  }, [open, requestId, t]);

  const act = async (kind: 'run' | 'deliver' | 'download' | 'verify') => {
    // One action at a time, claimed BEFORE the confirmation is awaited: a double-click must not
    // open two confirmations (and so execute twice).
    if (acting.current) return;
    acting.current = true;
    const id = requestId;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'run' && plan && IRREVERSIBLE.has(plan.disposition)) {
        const ok = await confirm({
          title: t('confirmErase.title'),
          message: t('confirmErase.message', { subject: subject?.trim() || t('confirmErase.subjectFallback') }),
          confirmLabel: t('confirmErase.confirmLabel'),
        });
        if (!ok || shown.current !== id) return;
      }
      if (kind === 'verify') {
        await verifyDsrIdentity(id);
        const next = await planDsr(id);
        if (shown.current === id) setPlan(next);
      } else if (kind === 'download') {
        const file = await fetchDsrExport(id);
        downloadBlob(file.blob, file.filename);
      } else {
        const out = await (kind === 'run' ? executeDsr(id) : markDsrDelivered(id));
        if (shown.current === id) setResult(out.result);
        onDone();
      }
    } catch (e) {
      if (shown.current === id) setError(faultMessage(e, t('error')) ?? t('error'));
    } finally {
      acting.current = false;
      setBusy(null);
    }
  };

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('title')} crumb={t('crumb')} width="wide" widthStorageKey="dsr-execute">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('intro')}</div>
        {plan && <div>{t(`disposition.${plan.disposition}`)}</div>}
        {plan?.verified && <div style={{ color: 'var(--success-text)' }}>{t('identityVerified')}</div>}
        {plan && !plan.verified && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: 'var(--warning-text)' }}>{t('notVerified')}</div>
            <div>
              <RoleGate capability={GOVERNANCE_WRITE_CAP}>
                <button onClick={() => void act('verify')} disabled={busy !== null} style={btnGhost}>
                  {busy === 'verify' ? t('verifying') : t('verifyIdentity')}
                </button>
              </RoleGate>
            </div>
          </div>
        )}

        {!result && plan && (
          <div>
            <RoleGate capability={GOVERNANCE_WRITE_CAP}>
              <button onClick={() => void act('run')} disabled={busy !== null || !plan.verified} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
                {busy === 'run' ? t('running') : t('run')}
              </button>
            </RoleGate>
          </div>
        )}

        {error && <div role="alert" style={{ ...bar, background: 'var(--danger-bg)', color: 'var(--danger-text)', borderColor: 'var(--danger-border)' }}>{error}</div>}

        {result && (
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 600 }}>{t(`done.${result.status}`)}</div>
            {result.disposition !== 'export' && result.disposition !== 'manual' && (
              <div>{result.suppressionAdded ? t('suppressionAdded') : t('suppressionExisting')}</div>
            )}
            {Object.keys(result.exported).length > 0 && <div>{t('exported')}: {counts(result.exported)}</div>}
            {result.disposition === 'suppress_and_erase' && (
              <div>{t('erased')}: {Object.keys(result.erased).length > 0 ? counts(result.erased) : t('none')}</div>
            )}
            {result.outstanding.length > 0 && <div style={{ color: 'var(--warning-text)' }}>{t('outstanding', { stores: result.outstanding.join(', ') })}</div>}

            {result.exportUrl && (
              <div>
                <button onClick={() => void act('download')} disabled={busy !== null} style={btnGhost}>
                  {busy === 'download' ? t('downloading') : t('download')}
                </button>
              </div>
            )}
            {result.status === 'processing' && result.disposition === 'export' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('deliverHint')}</div>
                <div>
                  <RoleGate capability={GOVERNANCE_WRITE_CAP}>
                    <button onClick={() => void act('deliver')} disabled={busy !== null} style={btn}>
                      {busy === 'deliver' ? t('delivering') : t('markDelivered')}
                    </button>
                  </RoleGate>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SlideOutPanel>
  );
}

const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' };
const bar: React.CSSProperties = { padding: '8px 12px', border: '1px solid', borderRadius: 'var(--radius-sm)' };
