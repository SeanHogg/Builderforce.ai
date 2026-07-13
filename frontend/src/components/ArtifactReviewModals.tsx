'use client';

import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ChatMessageContent } from './ChatMessageContent';

/**
 * Shared review panels for generated project artifacts (PRD + Tasks). Both the
 * message-action buttons ([ChatProjectActions]) and the Brain `generate_prd` /
 * `generate_tasks` tools ([IDE]) render these so a generated artifact is always
 * reviewed before it lands in the project — one panel, two call sites.
 *
 * Rendered as slide-out panels (not modals): approving a preview is a constructive
 * save, not a terminal/destructive confirm, so per the app convention it uses
 * SlideOutPanel.
 */

const footerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  alignItems: 'center',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
};

const confirmBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  background: 'var(--coral-bright)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
};

function ModalError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--error-text, #ef4444)' }}>{error}</span>
  );
}

export function PrdReviewModal({
  prd,
  onCancel,
  onConfirm,
  error,
  saving,
}: {
  prd: string;
  onCancel: () => void;
  onConfirm: () => void;
  error?: string | null;
  saving?: boolean;
}) {
  const t = useTranslations('artifactReview');
  const tc = useTranslations('common');
  return (
    <SlideOutPanel open onClose={onCancel} title={t('prdTitle')} width="min(720px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <ChatMessageContent content={prd} />
        </div>
        <div style={footerStyle}>
          <ModalError error={error} />
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            {tc('cancel')}
          </button>
          <button type="button" onClick={onConfirm} disabled={saving} style={{ ...confirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? tc('saving') : t('savePrd')}
          </button>
        </div>
      </div>
    </SlideOutPanel>
  );
}

export function TasksReviewModal({
  titles,
  descriptions,
  onCancel,
  onConfirm,
  error,
  saving,
}: {
  titles: string[];
  descriptions: string[];
  onCancel: () => void;
  onConfirm: () => void;
  error?: string | null;
  saving?: boolean;
}) {
  const t = useTranslations('artifactReview');
  const tc = useTranslations('common');
  return (
    <SlideOutPanel open onClose={onCancel} title={t('tasksTitle', { count: titles.length })} width="min(720px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
          {titles.map((title, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              <strong>{title}</strong>
              {descriptions[i] && (
                <span style={{ color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>{descriptions[i]}</span>
              )}
            </li>
          ))}
        </ul>
        <div style={footerStyle}>
          <ModalError error={error} />
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            {tc('cancel')}
          </button>
          <button type="button" onClick={onConfirm} disabled={saving} style={{ ...confirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? t('adding') : t('addAllTasks')}
          </button>
        </div>
      </div>
    </SlideOutPanel>
  );
}
