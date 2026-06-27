'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { pmoApi, type PmoTree } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { RoleGate } from '@/components/RoleGate';

/**
 * Initiative picker for a project's details panel — links/unlinks the project to
 * a PMO initiative via the canonical pmoApi.linkProject endpoint (the single
 * writer; no duplicated link logic). Self-contained and localized: it derives the
 * current link from the PMO tree, so it doesn't depend on the Project DTO carrying
 * initiativeId. Manager-gated (disable + hint via RoleGate, server-enforced).
 */
const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8,
  border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', color: 'var(--text-primary)',
};

export function ProjectInitiativeLink({ projectId }: { projectId: number }) {
  const t = useTranslations('pmo');
  const { data, reload } = usePmData<PmoTree>(() => pmoApi.tree(), []);

  const current = data?.projects.find((p) => p.id === projectId)?.initiativeId ?? '';
  const initiatives = data?.initiatives ?? [];

  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('projectLink.title')}</label>
      <RoleGate capability="insights.portfolio" variant="block" silent>
        <Select
          value={current}
          disabled={!data}
          onChange={async (e) => {
            await pmoApi.linkProject(projectId, e.target.value || null);
            reload();
          }}
          style={selectStyle}
        >
          <option value="">{t('projectLink.none')}</option>
          {initiatives.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
      </RoleGate>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        {data ? t('projectLink.hint') : t('projectLink.loading')}
      </div>
    </div>
  );
}
