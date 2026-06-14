'use client';

import { ChatMessageContent } from './ChatMessageContent';

/**
 * Shared review modals for generated project artifacts (PRD + Tasks). Both the
 * message-action buttons ([ChatProjectActions]) and the Brain `generate_prd` /
 * `generate_tasks` tools ([IDE]) render these so a generated artifact is always
 * reviewed before it lands in the project — one modal, two call sites.
 */

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const headerStyle: React.CSSProperties = {
  padding: 12,
  borderBottom: '1px solid var(--border-subtle)',
  fontWeight: 600,
  fontFamily: 'var(--font-display)',
};

const footerStyle: React.CSSProperties = {
  padding: 12,
  borderTop: '1px solid var(--border-subtle)',
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
    <span style={{ marginRight: 'auto', fontSize: 12, color: '#ef4444' }}>{error}</span>
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
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          maxWidth: 720,
          maxHeight: '85vh',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerStyle}>Generated PRD</div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, fontSize: 13, lineHeight: 1.6 }}>
          <ChatMessageContent content={prd} />
        </div>
        <div style={footerStyle}>
          <ModalError error={error} />
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={saving} style={{ ...confirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save to project PRDs'}
          </button>
        </div>
      </div>
    </div>
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
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          maxWidth: 480,
          maxHeight: '80vh',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerStyle}>Generated tasks ({titles.length})</div>
        <ul style={{ flex: 1, overflow: 'auto', padding: 16, margin: 0, fontSize: 13, lineHeight: 1.5 }}>
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
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={saving} style={{ ...confirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Adding…' : 'Add all to project tasks'}
          </button>
        </div>
      </div>
    </div>
  );
}
