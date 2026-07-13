'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toolsApi } from '@/lib/builderforceApi';
import type { SystemAuditSummary } from '@/lib/tools';

/**
 * Onboarding step: kick off system-level audits (SOC 2, Architecture, Quality,
 * PM Vision) against the new project. This is the "create a ticket for the
 * security agent → run the audit" step: each selected audit scores an instant
 * report, records it as a project diagnostic, notifies the user, and files the
 * agent remediation ticket. SOC 2 is pre-selected — the adoption hook.
 */
type Status = 'idle' | 'running' | 'done' | 'error';

export function WizardAuditStep({ projectId }: { projectId: number }) {
  const t = useTranslations('onboarding.audit');
  const router = useRouter();
  const [audits, setAudits] = useState<SystemAuditSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [running, setRunning] = useState(false);
  const [ranAny, setRanAny] = useState(false);

  useEffect(() => {
    let live = true;
    toolsApi.listAudits().then((a) => {
      if (!live) return;
      setAudits(a);
      // Pre-select SOC 2 (the adoption hook); fall back to the first audit.
      const soc2 = a.find((x) => x.id === 'soc2-audit') ?? a[0];
      if (soc2) setSelected(new Set([soc2.id]));
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const runSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setRunning(true);
    setStatus(Object.fromEntries(ids.map((id) => [id, 'running' as Status])));
    await Promise.all(ids.map(async (id) => {
      try {
        await toolsApi.runAudit(id, projectId);
        setStatus((s) => ({ ...s, [id]: 'done' }));
      } catch {
        setStatus((s) => ({ ...s, [id]: 'error' }));
      }
    }));
    setRunning(false);
    setRanAny(true);
  };

  const viewReports = () => router.push(`/projects?project=${projectId}&panel=diagnostics`);

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>{t('intro')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {audits.map((a) => {
          const isSel = selected.has(a.id);
          const st = status[a.id] ?? 'idle';
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => !running && toggle(a.id)}
              disabled={running}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%',
                padding: '12px 14px', borderRadius: 10,
                background: isSel ? 'rgba(244,114,110,0.1)' : 'var(--bg-elevated)',
                border: `1px solid ${isSel ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                cursor: running ? 'default' : 'pointer',
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{a.icon}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{a.name}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{a.blurb}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: st === 'done' ? '#22c55e' : st === 'error' ? 'var(--error-text, #e74c3c)' : st === 'running' ? 'var(--coral-bright)' : isSel ? 'var(--coral-bright)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {st === 'running' ? t('running') : st === 'done' ? t('started') : st === 'error' ? t('failed') : isSel ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={runSelected}
          disabled={running || selected.size === 0}
          style={{
            padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 10, border: 'none', color: '#fff',
            background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
            cursor: running || selected.size === 0 ? 'not-allowed' : 'pointer', opacity: running || selected.size === 0 ? 0.6 : 1,
          }}
        >
          {running ? t('runningAll') : t('run')}
        </button>
        {ranAny && (
          <button type="button" onClick={viewReports} style={{
            padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 10,
            background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', cursor: 'pointer',
          }}>{t('viewReports')}</button>
        )}
      </div>

      {ranAny && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>{t('notifyHint')}</p>}
    </div>
  );
}
