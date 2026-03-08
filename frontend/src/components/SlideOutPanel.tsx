'use client';

export interface SlideOutPanelTab {
  id: string;
  label: string;
}

export interface SlideOutPanelProps {
  open: boolean;
  onClose: () => void;
  /** Panel title (optional). */
  title?: React.ReactNode;
  /** Optional tabs; when provided, activeTabId and onTabChange control which tab is active. */
  tabs?: SlideOutPanelTab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  /** Header actions (e.g. buttons) rendered after title. */
  headerActions?: React.ReactNode;
  /** Main content. */
  children: React.ReactNode;
  /** Drawer width. Default min(560px, 96vw). */
  width?: string;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  zIndex: 9998,
};

export function SlideOutPanel({
  open,
  onClose,
  title,
  tabs,
  activeTabId,
  onTabChange,
  headerActions,
  children,
  width = 'min(560px, 96vw)',
}: SlideOutPanelProps) {
  if (!open) return null;

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={overlayStyle}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Panel'}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width,
          maxWidth: '100%',
          background: 'var(--bg-deep)',
          borderLeft: '1px solid var(--border-subtle)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {(title != null || headerActions != null) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              style={{
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--bg-base)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {title != null && (
              <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
                {title}
              </div>
            )}
            {headerActions}
          </div>
        )}
        {tabs != null && tabs.length > 0 && (
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
              overflowX: 'auto',
            }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange?.(t.id)}
                style={{
                  padding: '10px 16px',
                  fontSize: '0.875rem',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: `2px solid ${activeTabId === t.id ? 'var(--coral-bright, #f4726e)' : 'transparent'}`,
                  color: activeTabId === t.id ? 'var(--coral-bright, #f4726e)' : 'var(--text-muted)',
                  fontWeight: activeTabId === t.id ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </>
  );
}
