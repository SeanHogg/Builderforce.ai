import type { CSSProperties } from 'react';

/* Theme-aware: uses --chat-input-* from globals.css (light and dark).
   Sizing comes from the shared --chat-ctl-* metrics so every control in the
   composer (and the toolbars around it) stays one size, and coarse pointers get
   the touch-friendly variant without a second set of numbers here. */
export const iconButtonStyle = (disabled?: boolean): CSSProperties => ({
  width: 'var(--chat-ctl-size, 32px)',
  height: 'var(--chat-ctl-size, 32px)',
  minWidth: 'var(--chat-ctl-size, 32px)',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  border: '1px solid var(--chat-input-border)',
  background: 'var(--chat-input-bg)',
  color: disabled ? 'var(--chat-input-disabled-icon)' : 'var(--chat-input-icon)',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'transparent',
  color: 'var(--chat-input-text)',
  fontSize: '0.9375rem',
  borderRadius: 0,
  padding: '6px 4px',
  outline: 'none',
  border: 'none',
  fontFamily: 'var(--font-body)',
  lineHeight: 1.4,
  resize: 'none',
};

/** The composer's textarea: the input style, given the full row. */
export const textareaStyle: CSSProperties = { ...inputStyle, flexBasis: '100%', minWidth: '100%' };

export const sendButtonStyle = (disabled: boolean): CSSProperties => ({
  width: 'var(--chat-ctl-size, 32px)',
  height: 'var(--chat-ctl-size, 32px)',
  minWidth: 'var(--chat-ctl-size, 32px)',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  border: 'none',
  background: disabled ? 'var(--chat-input-disabled-send-bg)' : 'var(--chat-input-send-bg)',
  color: 'var(--chat-input-send-icon)',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

export const menuPopStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  zIndex: 50,
  minWidth: 224,
  padding: 5,
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
};
