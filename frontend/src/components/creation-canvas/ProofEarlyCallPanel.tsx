/**
 * "Call it early…" (PRD 33 §5.3.2): a person grades a proof before its window
 * closes. The reason is REQUIRED — the API refuses an early call without one and
 * keeps it on the record beside the measured numbers, which replace whatever was
 * on screen. A `SlideOutPanel` sheet, not a modal: it is a form, not a destructive
 * approval.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { realizationApi, type Realization } from '@/lib/realizationApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';

export interface ProofEarlyCallPanelProps {
  realizationId: string;
  open: boolean;
  onClose: () => void;
  onCalled: (realization: Realization) => void;
}

export function ProofEarlyCallPanel({ realizationId, open, onClose, onCalled }: ProofEarlyCallPanelProps) {
  const t = useTranslations('creationCanvas.proof');
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) {
      setError(t('reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCalled(await realizationApi.callEarly(realizationId, reason.trim()));
      setReason('');
      onClose();
    } catch (cause) {
      setError(errorMessage(cause) ?? t('callEarlyFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('callEarlyTitle')} width="sheet">
      <form
        style={{ display: 'grid', gap: 'var(--space-3, 12px)' }}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>{t('callEarlyBody')}</p>
        <label htmlFor={`proof-early-${realizationId}`} style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>
          {t('reasonLabel')}
        </label>
        <textarea
          id={`proof-early-${realizationId}`}
          value={reason}
          required
          maxLength={500}
          rows={4}
          disabled={busy}
          placeholder={t('reasonPlaceholder')}
          onChange={(event) => setReason(event.target.value)}
          style={{
            width: '100%', resize: 'vertical', padding: 10, fontFamily: 'inherit', fontSize: 14,
            background: 'var(--surface)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          }}
        />
        {error && <p role="alert" style={{ margin: 0, color: 'var(--error)', fontSize: 13 }}>{error}</p>}
        <div>
          <button type="submit" className="btn-primary" style={{ minHeight: 44 }} disabled={busy || !reason.trim()}>
            {busy ? t('calling') : t('callEarlySubmit')}
          </button>
        </div>
      </form>
    </SlideOutPanel>
  );
}
