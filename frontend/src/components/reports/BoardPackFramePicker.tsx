/**
 * "Which frame is this board pack OF?" — pick a board, then a frame on it.
 *
 * The frame list comes from `GET /api/reports/schedules/board-pack/frames`, the
 * same check POST runs, so a frame offered here is one the server will accept.
 * The value handed back is the `subjectRef` the server built for that frame —
 * this control never assembles `"<sessionId>:<frameId>"` itself.
 */

import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { LabelField, SectionError } from '@/components/ui';
import { useBoardPackPicker } from '@/lib/reports/useBoardPackPicker';

const stackStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const mutedStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' };

export function BoardPackFramePicker({ sessionId, subjectRef, onSession, onFrame, disabled = false }: {
  sessionId: string;
  subjectRef: string;
  onSession: (sessionId: string) => void;
  onFrame: (subjectRef: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('financeHub.reports');
  const { sessions, sessionsLoading, frames, framesLoading, error } = useBoardPackPicker(sessionId, true);

  return (
    <div style={stackStyle}>
      <LabelField label={t('field.board')}>
        <Select
          aria-label={t('field.board')}
          value={sessionId}
          disabled={disabled || sessionsLoading}
          onChange={(e) => onSession(e.target.value)}
        >
          <option value="">{sessionsLoading ? t('loading') : t('boardPlaceholder')}</option>
          {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
        </Select>
      </LabelField>
      {!sessionsLoading && sessions.length === 0 && <p style={mutedStyle}>{t('noBoards')}</p>}

      {sessionId && (
        <LabelField label={t('field.frame')}>
          <Select
            aria-label={t('field.frame')}
            value={subjectRef}
            disabled={disabled || framesLoading || frames.length === 0}
            onChange={(e) => onFrame(e.target.value)}
          >
            <option value="">{framesLoading ? t('loading') : t('framePlaceholder')}</option>
            {frames.map((frame) => (
              <option key={frame.id} value={frame.subjectRef}>
                {t('frameOption', { title: frame.title, count: frame.tileCount })}
              </option>
            ))}
          </Select>
        </LabelField>
      )}
      {sessionId && !framesLoading && frames.length === 0 && <p style={mutedStyle}>{t('noFrames')}</p>}
      <SectionError error={error} />
    </div>
  );
}
