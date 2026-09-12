'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { runtimeApi } from '@/lib/builderforceApi';
import { useErrorText } from '@/i18n/useErrorMessage';
export default function AgentExecutionControl() {
  const t = useTranslations('agentExecution');
  const confirm = useConfirm();
  const errorText = useErrorText();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const state = await runtimeApi.executionControl();
      setEnabled(state.enabled);
      setNotice('');
    } catch (error) {
      setNotice(errorText(error));
    }
  }, [errorText]);

  useEffect(() => { void load(); }, [load]);

  const change = useCallback(async (next: boolean) => {
    if (!next && !(await confirm({
      title: t('confirmTitle'),
      message: t('confirmBody'),
      confirmLabel: t('disableAll'),
      destructive: true,
    }))) return;

    setSaving(true);
    setNotice('');
    try {
      const result = await runtimeApi.setExecutionControl(next);
      setEnabled(result.enabled);
      if (!next) {
        const stopped = result.stopped;
        setNotice(stopped?.failed.length
          ? t('stoppedSome', { cancelled: stopped.cancelled, failed: stopped.failed.length })
          : t('stoppedAll', { count: stopped?.cancelled ?? 0 }));
      } else {
        setNotice(t('enabledNotice'));
      }
    } catch (error) {
      setNotice(errorText(error));
      await load();
    } finally {
      setSaving(false);
    }
  }, [confirm, load, errorText, t]);

  const disabled = enabled === false;
  return (
    <div style={{
      background: disabled ? 'var(--danger-bg)' : 'var(--bg-base)',
      border: `1px solid ${disabled ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
      borderRadius: 'var(--radius-lg)', padding: 20, marginTop: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            {t('title')}
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>
            {disabled ? t('disabledBody') : t('enabledBody')}
          </p>
        </div>
        <RoleGate capability="runtime.control">
          <button
            type="button"
            disabled={saving || enabled == null}
            onClick={() => void change(disabled)}
            style={{
              minHeight: 40, padding: '8px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700,
              border: `1px solid ${disabled ? 'var(--accent)' : 'var(--coral-bright)'}`,
              background: disabled ? 'var(--accent)' : 'var(--danger-bg)',
              color: disabled ? 'var(--text-on-accent)' : 'var(--coral-bright)',
              cursor: saving || enabled == null ? 'default' : 'pointer',
              opacity: saving || enabled == null ? 0.6 : 1,
            }}
          >
            {saving ? t('updating') : disabled ? t('enable') : t('disableAll')}
          </button>
        </RoleGate>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: disabled ? 'var(--coral-bright)' : 'var(--text-secondary)' }}>
        {enabled == null ? t('statusLoading') : enabled ? t('statusEnabled') : t('statusDisabled')}
      </div>
      {notice && <div role="status" style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>{notice}</div>}
    </div>
  );
}
