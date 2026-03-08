'use client';

interface ViewToggleProps {
  activeView: 'preview' | 'code';
  onViewChange: (view: 'preview' | 'code') => void;
}

export function ViewToggle({ activeView, onViewChange }: ViewToggleProps) {
  const buttonStyle = (isActive: boolean) => ({
    flex: 1,
    padding: '8px 16px',
    background: isActive ? 'var(--surface-interactive)' : 'transparent',
    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
    transition: 'all 0.2s ease',
    borderBottom: isActive ? '2px solid var(--coral-bright)' : '2px solid transparent',
  });

  return (
    <div style={{
      display: 'flex',
      gap: 0,
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-elevated)',
    }}>
      <button
        onClick={() => onViewChange('preview')}
        style={buttonStyle(activeView === 'preview')}
      >
        Preview
      </button>
      <button
        onClick={() => onViewChange('code')}
        style={buttonStyle(activeView === 'code')}
      >
        Code
      </button>
    </div>
  );
}
