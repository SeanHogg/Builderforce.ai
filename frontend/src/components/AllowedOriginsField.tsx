'use client';

/**
 * Shared origin-allowlist input — used by both the owner self-service mint
 * page and the superadmin mint-on-behalf flow.
 *
 * Mode is driven by a radio group, not a prop-drilled boolean, so the parent
 * doesn't need to compute "should I show the textarea?" — this component
 * owns its own conditional rendering of the allowlist textarea.
 */
import { useState, type ReactNode } from 'react';

export type OriginsMode = 'server-only' | 'any-origin' | 'allowlist';

const radioRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  fontSize: 13,
  marginBottom: 6,
  cursor: 'pointer',
};
const helpText: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  marginLeft: 24,
  marginBottom: 8,
};

interface Props {
  /** Current state. The hosting form controls origins via this single source of truth. */
  value: string[] | null;
  /** Called whenever the effective origins value changes. `null` = server-only. */
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}

/** Translate origins → mode without prop-drilling a separate canX flag. */
function modeFor(value: string[] | null): OriginsMode {
  if (value === null) return 'server-only';
  if (value.includes('*')) return 'any-origin';
  return 'allowlist';
}

export function AllowedOriginsField({ value, onChange, disabled }: Props) {
  const [text, setText] = useState(() => (value && !value.includes('*')) ? value.join('\n') : '');
  const mode = modeFor(value);

  const handleMode = (next: OriginsMode) => {
    if (next === 'server-only')  onChange(null);
    if (next === 'any-origin')   onChange(['*']);
    if (next === 'allowlist') {
      const list = text.split('\n').map((s) => s.trim()).filter(Boolean);
      onChange(list.length > 0 ? list : []);
    }
  };

  const handleText = (raw: string) => {
    setText(raw);
    if (mode === 'allowlist') {
      const list = raw.split('\n').map((s) => s.trim()).filter(Boolean);
      onChange(list);
    }
  };

  return (
    <div>
      <RadioOption checked={mode === 'server-only'} onSelect={() => handleMode('server-only')} disabled={disabled} label="Server-only (recommended)">
        Reject any browser request. Use for keys you keep in your worker / backend env.
      </RadioOption>

      <RadioOption checked={mode === 'allowlist'} onSelect={() => handleMode('allowlist')} disabled={disabled} label="Allow specific origins">
        Browser calls work only from these origins. Use exact origins (one per line):{' '}
        <code style={{ fontFamily: 'var(--font-mono)' }}>https://hired.video</code>.
      </RadioOption>

      {mode === 'allowlist' && (
        <textarea
          value={text}
          onChange={(e) => handleText(e.target.value)}
          disabled={disabled}
          placeholder={'https://hired.video\nhttps://staging.hired.video\nhttp://localhost:3000'}
          rows={4}
          style={{
            width: '100%', marginLeft: 24, marginBottom: 8, marginTop: 4,
            fontFamily: 'var(--font-mono)', fontSize: 12, padding: 8,
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
      )}

      <RadioOption checked={mode === 'any-origin'} onSelect={() => handleMode('any-origin')} disabled={disabled} label="Allow any origin (*)">
        Escape hatch — any site can call with this key. Equivalent to shipping a long-lived secret to the world. Don&apos;t.
      </RadioOption>
    </div>
  );
}

function RadioOption(
  { checked, onSelect, disabled, label, children }:
  { checked: boolean; onSelect: () => void; disabled?: boolean; label: string; children: ReactNode },
) {
  return (
    <>
      <label style={radioRow}>
        <input type="radio" checked={checked} onChange={onSelect} disabled={disabled} />
        <span style={{ fontWeight: 600 }}>{label}</span>
      </label>
      <div style={helpText}>{children}</div>
    </>
  );
}
