'use client';

/** Who a campaign sends to — fed automatically by site form submissions. */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { growthApi, type Audience } from '@/lib/growthApi';
import { button, input, listItem, listReset, muted, spread, Row } from './growthStyles';
import { usePanelTask } from '@/hooks/usePanelTask';
export function AudiencesSection() {
  const t = useTranslations('growth');
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [audienceName, setAudienceName] = useState('');
  const task = usePanelTask();
  const { run: taskRun } = task;

  const reload = useCallback(async () => {
    const { audiences: a } = await growthApi.listAudiences();
    setAudiences(a);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // The reload is part of the action, so the notice lands only once the list shows it.
  const run = useCallback((op: () => Promise<unknown>, success: string) => taskRun(async () => {
    await op();
    await reload();
  }, { success, failure: t('genericError') }), [taskRun, reload, t]);

  return (
    <section>
      {task.notice && <p role="status" style={{ ...muted, color: 'var(--success-text)' }}>{task.notice}</p>}
      {task.error && <p role="alert" style={{ ...muted, color: 'var(--danger-text)' }}>{task.error}</p>}
      {audiences.length === 0 ? (
        <p style={{ ...muted, marginTop: 10 }}>{t('audiences.empty')}</p>
      ) : (
        <ul style={listReset}>
          {audiences.map((audience) => (
            <li key={audience.id} style={{ ...listItem, ...spread }}>
              <span>{audience.name}</span>
              <span style={muted}>{t('audiences.memberCount', { count: audience.memberCount })}</span>
            </li>
          ))}
        </ul>
      )}
      <Row>
        <input style={input} value={audienceName} disabled={task.busy}
          onChange={(e) => setAudienceName(e.target.value)}
          placeholder={t('audiences.namePlaceholder')} aria-label={t('audiences.nameLabel')} />
        <button type="button" style={button} disabled={task.busy || !audienceName.trim()}
          onClick={() => run(
            () => growthApi.createAudience({ name: audienceName }).then(() => setAudienceName('')),
            t('audiences.created'),
          )}>
          {t('audiences.add')}
        </button>
      </Row>
    </section>
  );
}
