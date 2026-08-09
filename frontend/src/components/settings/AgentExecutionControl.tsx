'use client';

import { useCallback, useEffect, useState } from 'react';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { runtimeApi } from '@/lib/builderforceApi';

export default function AgentExecutionControl() {
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const state = await runtimeApi.executionControl();
      setEnabled(state.enabled);
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load agent execution control.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const change = useCallback(async (next: boolean) => {
    if (!next && !(await confirm({
      title: 'Disable all agent execution?',
      message: 'This immediately cancels queued, running, or paused tenant agents and blocks manual, scheduled, and autonomous platform runs until a manager enables execution again. VS Code and Brain chats, Canvas/Create, and page MCP tools remain available.',
      confirmLabel: 'Disable and stop all agents',
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
          ? `Execution is disabled. ${stopped.cancelled} runs stopped; ${stopped.failed.length} could not be cancelled.`
          : `Execution is disabled. ${stopped?.cancelled ?? 0} active runs stopped.`);
      } else {
        setNotice('Agent execution is enabled.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update agent execution control.');
      await load();
    } finally {
      setSaving(false);
    }
  }, [confirm, load]);

  const disabled = enabled === false;
  return (
    <div style={{
      background: disabled ? 'rgba(244,114,94,0.08)' : 'var(--bg-base)',
      border: `1px solid ${disabled ? 'var(--coral-bright, #f4726e)' : 'var(--border-subtle)'}`,
      borderRadius: 'var(--radius-lg)', padding: 20, marginTop: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            Agent execution kill switch
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>
            {disabled
              ? 'Tenant agent execution is blocked. VS Code and Brain chats, Canvas/Create, and page MCP tools remain available.'
              : 'Emergency workspace override. Disabling stops tenant agents and blocks manual, scheduled, integration, and autonomous platform runs; interactive VS Code and Brain work remains available.'}
          </p>
        </div>
        <RoleGate capability="runtime.control">
          <button
            type="button"
            disabled={saving || enabled == null}
            onClick={() => void change(disabled)}
            style={{
              minHeight: 40, padding: '8px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700,
              border: `1px solid ${disabled ? 'var(--accent, #6366f1)' : 'var(--coral-bright, #f4726e)'}`,
              background: disabled ? 'var(--accent, #6366f1)' : 'rgba(244,114,94,0.1)',
              color: disabled ? '#fff' : 'var(--coral-bright, #f4726e)',
              cursor: saving || enabled == null ? 'default' : 'pointer',
              opacity: saving || enabled == null ? 0.6 : 1,
            }}
          >
            {saving ? 'Updating…' : disabled ? 'Enable agent execution' : 'Disable and stop all agents'}
          </button>
        </RoleGate>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: disabled ? 'var(--coral-bright, #f4726e)' : 'var(--text-secondary)' }}>
        Status: {enabled == null ? 'Loading…' : enabled ? 'Execution enabled' : 'EXECUTION DISABLED'}
      </div>
      {notice && <div role="status" style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>{notice}</div>}
    </div>
  );
}
