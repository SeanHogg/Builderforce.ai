'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { meetingsApi, type MeetingTranscript } from '@/lib/builderforceApi';
import { MeetingTranscriptList } from './MeetingTranscriptList';

/**
 * Past-meeting notes — the searchable record of a finished meeting: its AI minutes
 * plus the full transcript. Rendered as a slide-out panel (app convention). If the
 * meeting was never summarized, any participant can generate the minutes here.
 */
export function MeetingNotes({
  meetingId, title, open, onClose,
}: {
  meetingId: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('meetings');
  const [data, setData] = useState<MeetingTranscript | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    meetingsApi.transcript(meetingId)
      .then(setData)
      .catch(() => setData({ segments: [], summary: null, summaryGeneratedAt: null }))
      .finally(() => setLoading(false));
  }, [meetingId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const generate = useCallback(async () => {
    setBusy(true);
    try { await meetingsApi.summarize(meetingId); load(); } catch { /* surfaced by empty state */ } finally { setBusy(false); }
  }, [meetingId, load]);

  const canGenerate = !!data && !data.summary && data.segments.length > 0;

  return (
    <SlideOutPanel open={open} onClose={onClose} title={title}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
        ) : (
          <>
            {canGenerate && (
              <button
                type="button"
                onClick={generate}
                disabled={busy}
                style={{ alignSelf: 'flex-start', fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', background: 'var(--coral-bright)', color: 'var(--bg-deep)', border: 'none', opacity: busy ? 0.6 : 1 }}
              >
                {busy ? t('generatingMinutes') : t('generateMinutes')}
              </button>
            )}
            <MeetingTranscriptList segments={data?.segments ?? []} summary={data?.summary ?? null} />
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}
