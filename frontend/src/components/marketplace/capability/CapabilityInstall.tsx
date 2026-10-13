import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_REPLAY_SITE_SETTINGS } from '@builderforce/interaction-contract';
import { Button, SectionLoading } from '@/components/ui';
import { RoleGate } from '@/components/RoleGate';
import { replaySitesApi, type PublishedProjectChoice } from '@/lib/replaySitesApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { SiteSettingsForm, type SiteDraft } from './SiteSettingsForm';
import type { SetupStepProps } from './setupSteps';
import styles from './capability.module.css';

const SITE_MODES = ['external', 'hosted'] as const;
type SiteMode = (typeof SITE_MODES)[number];

/**
 * Step 2 — the site. An external site is a name, its allowed domains and the
 * privacy switches (→ a site + its `bfr_` key); a Builderforce-hosted app is a
 * switch on one of the workspace's published projects. Advances with the site
 * the server created.
 */
export function CapabilityInstall({ onDone }: SetupStepProps) {
  const t = useTranslations('marketplace.capability.site');
  const errorMessage = useErrorMessage();
  const [mode, setMode] = useState<SiteMode>('external');
  const [draft, setDraft] = useState<SiteDraft>({ label: '', allowedOrigins: [], settings: { ...DEFAULT_REPLAY_SITE_SETTINGS } });
  const [projects, setProjects] = useState<PublishedProjectChoice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'hosted' || projects) return undefined;
    let live = true;
    replaySitesApi.publishedProjects()
      .then((list) => { if (live) setProjects(list); })
      .catch((cause: unknown) => { if (live) { setProjects([]); setError(errorMessage(cause)); } });
    return () => { live = false; };
  }, [mode, projects, errorMessage]);

  const run = async (key: string, call: () => Promise<Parameters<SetupStepProps['onDone']>[0]>) => {
    setBusy(key);
    setError(null);
    try {
      onDone(await call());
    } catch (cause) {
      setError(errorMessage(cause) ?? t('failed'));
      setBusy(null);
    }
  };

  const canCreate = draft.label.trim().length > 0 && draft.allowedOrigins.length > 0 && busy === null;

  return (
    <div className={styles.stack}>
      <div className={styles.tabs} role="tablist" aria-label={t('modeLabel')}>
        {SITE_MODES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={`${styles.tab} ${mode === id ? styles.tabActive : ''}`}
            onClick={() => setMode(id)}
          >
            {t(`modes.${id}` as never)}
          </button>
        ))}
      </div>

      {mode === 'external' ? (
        <div className={styles.stack} role="tabpanel">
          <p className={styles.body}>{t('externalLead')}</p>
          <SiteSettingsForm value={draft} onChange={setDraft} />
          <RoleGate capability="insights.manageSites">
          <Button
            variant="primary"
            disabled={!canCreate}
            loading={busy === 'external'}
            data-testid="setup-create-site"
            onClick={() => void run('external', () => replaySitesApi.createExternal({
              label: draft.label.trim(),
              allowedOrigins: draft.allowedOrigins,
              settings: draft.settings,
            }))}
          >
            {t('create')}
          </Button>
          </RoleGate>
        </div>
      ) : (
        <div className={styles.stack} role="tabpanel">
          <p className={styles.body}>{t('hostedLead')}</p>
          {projects === null ? <SectionLoading label={t('loadingProjects')} /> : projects.length === 0 ? (
            <p className={styles.body}>{t('noProjects')}</p>
          ) : (
            <ul className={styles.list}>
              {projects.map((project) => (
                <li key={project.projectId} className={styles.listItem}>
                  <span className={styles.switchText}>
                    <span className={styles.switchLabel}>{project.name}</span>
                    <span className={styles.listMeta}>{project.url}</span>
                  </span>
                  <RoleGate capability="insights.manageSites">
                  <input
                    type="checkbox"
                    role="switch"
                    className={styles.switchInput}
                    checked={busy === `hosted:${project.projectId}`}
                    disabled={busy !== null}
                    aria-label={t('record', { name: project.name })}
                    onChange={() => void run(`hosted:${project.projectId}`, () => replaySitesApi.enableProjectSite(project.projectId))}
                  />
                  </RoleGate>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
