'use client';

import { useTranslations } from 'next-intl';
import { DocumentMarkdown } from '@/components/DocumentMarkdown';
import type { MeetingTranscriptSegment } from '@/lib/builderforceApi';

/**
 * Shared renderer for a meeting's minutes + transcript — used both in the live room
 * (the Transcript side panel) and in the past-meeting notes viewer. Agent lines are
 * tinted so an AI contribution reads distinctly from a person's.
 */
export function MeetingTranscriptList({
  segments, summary, showSummary = true,
}: {
  segments: MeetingTranscriptSegment[];
  summary: string | null;
  /** Render the generated minutes block above the transcript. */
  showSummary?: boolean;
}) {
  const t = useTranslations('meetings');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {showSummary && summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
            {t('minutesTitle')}
          </div>
          <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <DocumentMarkdown content={summary} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
          {t('transcript')}
        </div>
        {segments.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>{t('noTranscript')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {segments.map((s) => (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.speakerKind === 'agent' ? 'var(--violet-bright, #a78bfa)' : 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {s.speakerName}
                  {s.speakerKind === 'agent' && (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--bg-deep)', background: 'var(--violet-bright, #a78bfa)', padding: '1px 5px', borderRadius: 5 }}>
                      {t('agent')}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45 }}>{s.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
