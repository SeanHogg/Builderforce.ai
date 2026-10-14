/**
 * "Request a capture now" (PRD 33 §5.2): a manager asks the runner to capture a page
 * (or every key page) now instead of waiting for the next release or the weekly
 * pass. Once an hour per site — the API's 429 is said in place — and honest when the
 * deploy has no runner (`status: 'unavailable'` with its reason).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiRequestError } from '@/lib/apiClient';
import { replayApi } from '@/lib/replayApi';
import { PAGE_CAPTURE_LIMIT_STATUS } from '@/lib/replayPageApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { RoleGate } from '@/components/RoleGate';
import { Icon } from '@/components/ui/Icon';

/** The reasons `ReplayPageCaptureResultDto` may give for queueing nothing — keys under `replay.page.capture.unavailable`. */
const UNAVAILABLE_REASONS = new Set(['runner_unavailable', 'page_kit_unavailable', 'no_pages', 'no_origin']);

export function CaptureNowButton({ siteId, path }: { siteId: string; path: string | null }) {
  const t = useTranslations('replay.page.capture');
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'status' | 'alert' } | null>(null);

  const request = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await replayApi.requestPageCapture(siteId, path);
      if (result.status === 'queued') setNote({ text: t('queued', { count: result.queued }), tone: 'status' });
      else setNote({ text: t(`unavailable.${result.reason && UNAVAILABLE_REASONS.has(result.reason) ? result.reason : 'other'}`), tone: 'status' });
    } catch (failure) {
      const limited = failure instanceof ApiRequestError && failure.status === PAGE_CAPTURE_LIMIT_STATUS;
      setNote({ text: limited ? t('limited') : errorText(failure), tone: limited ? 'status' : 'alert' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
      <RoleGate capability="insights.actOnFixes">
        <button type="button" className="btn-secondary" style={{ minHeight: 44 }} disabled={busy} aria-busy={busy} onClick={() => void request()}>
          <Icon name="camera" size={14} /> {busy ? t('requesting') : t('request')}
        </button>
      </RoleGate>
      {note && (
        <p role={note.tone} style={{ margin: 0, fontSize: 'var(--font-size-small)', color: note.tone === 'alert' ? 'var(--error)' : 'var(--text-secondary)' }}>{note.text}</p>
      )}
    </div>
  );
}
