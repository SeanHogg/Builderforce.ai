'use client';

/**
 * SecurityTicketAccessCard — the setup configuration for WHO can see the
 * access-restricted SECURITY tickets the Security agent files. Owner/Manager only.
 * Default-deny: three audience toggles (team members / hired agents / talent) plus
 * explicit user + agent allowlists. Mirrors the server's security_ticket_access model.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  securityAgentApi,
  type SecurityAccessConfig,
  type SecurityAudiences,
} from '@/lib/builderforceApi';
import { faultMessage } from '@/lib/apiClient';
import { usePanelTask } from '@/hooks/usePanelTask';
import { useErrorMessage } from '@/i18n/useErrorMessage';
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', minHeight: 60, resize: 'vertical', fontFamily: 'inherit',
};

const linesToList = (v: string): string[] =>
  v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

export function SecurityTicketAccessCard() {
  const t = useTranslations('security');
  const errorMessage = useErrorMessage();
  const [cfg, setCfg] = useState<SecurityAccessConfig | null>(null);
  const [userIds, setUserIds] = useState('');
  const [agentRefs, setAgentRefs] = useState('');
  const [loading, setLoading] = useState(true);
  const task = usePanelTask();
  // Stable — the load effect runs once, so it must not key on `task`.
  const { fail } = task;

  useEffect(() => {
    securityAgentApi.getAccess()
      .then((c) => {
        setCfg(c);
        setUserIds((c.allowUserIds ?? []).join('\n'));
        setAgentRefs((c.allowAgentRefs ?? []).join('\n'));
      })
      .catch((e: Error) => { const message = faultMessage(e); if (message) fail(message); })
      .finally(() => setLoading(false));
  }, [fail]);

  const toggle = (key: keyof SecurityAudiences) => {
    if (!cfg) return;
    task.clear();
    setCfg({ ...cfg, audiences: { ...cfg.audiences, [key]: !cfg.audiences[key] } });
  };

  const save = async () => {
    if (!cfg) return;
    const next = await task.run(async () => {
      try {
        return await securityAgentApi.setAccess({
          audiences: cfg.audiences,
          allowUserIds: linesToList(userIds),
          allowAgentRefs: linesToList(agentRefs),
        });
      } catch (cause) {
        // The localized sentence (transport failures included), not the raw message;
        // an empty one — "signed out", nothing to report — leaves the slot empty.
        throw new Error(errorMessage(cause) ?? '');
      }
    }, { success: t('accessSaved') });
    if (next === undefined) return;
    setCfg(next);
    setUserIds((next.allowUserIds ?? []).join('\n'));
    setAgentRefs((next.allowAgentRefs ?? []).join('\n'));
  };

  const AUDIENCES: Array<{ key: keyof SecurityAudiences; label: string; hint: string }> = [
    { key: 'humans', label: t('accessHumans'), hint: t('accessHumansHint') },
    { key: 'hired', label: t('accessHired'), hint: t('accessHiredHint') },
    { key: 'talent', label: t('accessTalent'), hint: t('accessTalentHint') },
  ];

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ ...sectionTitle, marginBottom: 4 }}>{t('accessTitle')}</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>{t('accessSubtitle')}</p>

      {task.error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>{t('error', { message: task.error })}</div>}

      {loading || !cfg ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {AUDIENCES.map((a) => (
              <label
                key={a.key}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={cfg.audiences[a.key]}
                  onChange={() => toggle(a.key)}
                  style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--coral-bright)', flexShrink: 0 }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{a.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{a.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('accessAllowUsers')}</label>
              <textarea
                value={userIds}
                onChange={(e) => { setUserIds(e.target.value); task.clear(); }}
                placeholder={t('accessAllowUsersPlaceholder')}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('accessAllowAgents')}</label>
              <textarea
                value={agentRefs}
                onChange={(e) => { setAgentRefs(e.target.value); task.clear(); }}
                placeholder={t('accessAllowAgentsPlaceholder')}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void save()}
              disabled={task.busy}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                background: 'var(--coral-bright)', color: 'var(--text-on-accent)',
                border: 'none', borderRadius: 'var(--radius-md)', cursor: task.busy ? 'default' : 'pointer', opacity: task.busy ? 0.7 : 1,
              }}
            >
              {task.busy ? t('saving') : t('accessSave')}
            </button>
            {task.notice && <span style={{ fontSize: 12, color: 'var(--success-text, var(--success))' }}>{task.notice}</span>}
          </div>
        </>
      )}
    </div>
  );
}
