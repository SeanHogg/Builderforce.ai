'use client';

import { useState, useEffect } from 'react';
import { clawConfigApi } from '@/lib/builderforceApi';

interface ClawConfigContentProps {
  clawId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export function ClawConfigContent({ clawId }: ClawConfigContentProps) {
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [jsonValid, setJsonValid] = useState(true);

  useEffect(() => {
    setLoading(true);
    clawConfigApi
      .get(clawId)
      .then(({ config }) => {
        setRaw(config ? JSON.stringify(config, null, 2) : '{}');
      })
      .catch(() => {
        // If endpoint doesn't exist yet, default to empty config
        setRaw('{}');
      })
      .finally(() => setLoading(false));
  }, [clawId]);

  const handleChange = (value: string) => {
    setRaw(value);
    setSaveError(null);
    try {
      JSON.parse(value);
      setJsonValid(true);
    } catch {
      setJsonValid(false);
    }
  };

  const handleSave = async () => {
    if (!jsonValid) return;
    setSaving(true);
    setSaveError(null);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      await clawConfigApi.update(clawId, parsed);
      setSavedAt(new Date());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setRaw('{}');
    setJsonValid(true);
    setSaveError(null);
  };

  const handleFormat = () => {
    try {
      setRaw(JSON.stringify(JSON.parse(raw), null, 2));
      setJsonValid(true);
    } catch {
      // ignore
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading config…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Runtime Configuration</div>
          <button
            type="button"
            onClick={handleFormat}
            disabled={!jsonValid}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              cursor: jsonValid ? 'pointer' : 'not-allowed',
            }}
          >
            Format
          </button>
          <button
            type="button"
            onClick={handleReset}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          JSON configuration passed to the claw runtime. Changes take effect on next claw connection.
        </p>

        <textarea
          value={raw}
          onChange={(e) => handleChange(e.target.value)}
          spellCheck={false}
          rows={18}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.6,
            fontFamily: 'var(--font-mono)',
            background: 'var(--bg-elevated)',
            color: jsonValid ? 'var(--text-primary)' : 'var(--coral-bright, #f4726e)',
            border: `1px solid ${jsonValid ? 'var(--border-subtle)' : 'var(--coral-bright, #f4726e)'}`,
            borderRadius: 8,
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {!jsonValid && (
          <div style={{ fontSize: 11, color: 'var(--coral-bright, #f4726e)', marginTop: 6 }}>
            Invalid JSON — fix before saving.
          </div>
        )}

        {saveError && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright, #f4726e)', marginTop: 6 }}>
            {saveError}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
          {savedAt && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!jsonValid || saving}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              background: jsonValid && !saving ? 'var(--coral-bright, #f4726e)' : 'var(--bg-elevated)',
              color: jsonValid && !saving ? '#fff' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 8,
              cursor: !jsonValid || saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save Config'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>
          {error}
        </div>
      )}
    </div>
  );
}
