'use client';

import { useState } from 'react';
import { AllowedOriginsField } from '@/components/AllowedOriginsField';

/**
 * Inline editor for an existing tenant API key. Shared between the owner
 * self-service flow (`/settings/api-keys`) and the superadmin mint-on-behalf
 * tab so the edit UX never drifts between the two.
 *
 * The component manages its own open/closed state — parents render an Edit
 * button that toggles it and provide a single `onSave` callback that hits
 * whichever PATCH endpoint applies (owner vs admin). Self-rendering, no
 * prop-drilled `canX` flags.
 */

const cardStyle: React.CSSProperties = {
  marginTop: 10,
  padding: 14,
  borderRadius: 10,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
};

interface Props {
  initialName: string;
  initialAllowedOrigins: string[] | null;
  /** Called with the patch the parent should send. Resolves with the updated values to display. */
  onSave: (patch: { name?: string; allowedOrigins?: string[] | null }) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

export function TenantApiKeyEditor({ initialName, initialAllowedOrigins, onSave, onCancel, saving }: Props) {
  const [name, setName] = useState(initialName);
  const [allowedOrigins, setAllowedOrigins] = useState<string[] | null>(initialAllowedOrigins);
  const [error, setError] = useState<string | null>(null);

  // Decide what to send: only fields the user actually changed. Avoids
  // overwriting one column when the user just wanted to edit another.
  const buildPatch = (): { name?: string; allowedOrigins?: string[] | null } => {
    const patch: { name?: string; allowedOrigins?: string[] | null } = {};
    if (name.trim() !== initialName) patch.name = name.trim();
    if (!sameAllowlist(allowedOrigins, initialAllowedOrigins)) patch.allowedOrigins = allowedOrigins;
    return patch;
  };

  const handleSave = async () => {
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setError(null);
    try {
      await onSave(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
        Name
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={saving}
        style={{
          width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 14,
          background: 'var(--bg-base)', color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)', borderRadius: 8,
          boxSizing: 'border-box',
        }}
      />

      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
        Browser access
      </div>
      <AllowedOriginsField
        value={allowedOrigins}
        onChange={setAllowedOrigins}
        disabled={saving}
      />

      {error && (
        <div style={{ fontSize: 12, color: 'var(--coral-bright, #f4726e)', marginTop: 8 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || name.trim().length === 0}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            background: 'var(--surface-interactive)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
            opacity: saving || name.trim().length === 0 ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            background: 'none', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Set-equality on the allowlist so a reorder doesn't trigger a no-op save. */
function sameAllowlist(a: string[] | null, b: string[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
