'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { agentHostConfigApi } from '@/lib/builderforceApi';
import { useFormat } from "@/i18n/useFormat";
import { usePanelTask } from '@/hooks/usePanelTask';
interface AgentHostConfigContentProps {
  agentHostId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

export function AgentHostConfigContent({ agentHostId }: AgentHostConfigContentProps) {
  const tc = useTranslations('common');
  const t = useTranslations('agentHostTabs.config');
  const fmt = useFormat();
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(true);
  const task = usePanelTask();
  const [jsonValid, setJsonValid] = useState(true);

  useEffect(() => {
    setLoading(true);
    agentHostConfigApi
      .get(agentHostId)
      .then(({ config }) => {
        setRaw(config ? JSON.stringify(config, null, 2) : '{}');
      })
      .catch(() => {
        // If endpoint doesn't exist yet, default to empty config
        setRaw('{}');
      })
      .finally(() => setLoading(false));
  }, [agentHostId]);

  // Editing drops a save error but not the "Saved" line; while an error shows there is
  // no notice (the task holds one or the other), so clearing only then drops just it.
  const dropSaveError = () => { if (task.error) task.clear(); };

  const handleChange = (value: string) => {
    setRaw(value);
    dropSaveError();
    try {
      JSON.parse(value);
      setJsonValid(true);
    } catch {
      setJsonValid(false);
    }
  };

  const handleSave = async () => {
    if (!jsonValid) return;
    await task.run(async () => {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      await agentHostConfigApi.update(agentHostId, parsed);
    }, { success: () => t('saved', { time: fmt.time(new Date()) }) });
  };

  const handleReset = () => {
    setRaw('{}');
    setJsonValid(true);
    dropSaveError();
  };

  const handleFormat = () => {
    try {
      setRaw(JSON.stringify(JSON.parse(raw), null, 2));
      setJsonValid(true);
    } catch {
      // ignore
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{t('title')}</div>
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
              borderRadius: 'var(--radius-sm)',
              cursor: jsonValid ? 'pointer' : 'not-allowed',
            }}
          >
            {t('format')}
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
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            {t('reset')}
          </button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          {t('description')}
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
            color: jsonValid ? 'var(--text-primary)' : 'var(--coral-bright)',
            border: `1px solid ${jsonValid ? 'var(--border-subtle)' : 'var(--coral-bright)'}`,
            borderRadius: 'var(--radius-md)',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {!jsonValid && (
          <div style={{ fontSize: 11, color: 'var(--coral-bright)', marginTop: 6 }}>
            {t('invalidJson')}
          </div>
        )}

        {task.error && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginTop: 6 }}>
            {task.error}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
          {task.notice && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {task.notice}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!jsonValid || task.busy}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              background: jsonValid && !task.busy ? 'var(--coral-bright)' : 'var(--bg-elevated)',
              color: jsonValid && !task.busy ? 'var(--text-on-accent)' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: !jsonValid || task.busy ? 'not-allowed' : 'pointer',
            }}
          >
            {task.busy ? tc('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
