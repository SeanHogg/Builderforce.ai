'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { useLocalizedModalities } from '@/lib/useModalityCopy';
import { Icon } from '@/components/ui/Icon';
import styles from './DashboardCreationSessions.module.css';

const CANVAS_STARTERS = [
  { id: 'campaign-studio', icon: '◎', labelKey: 'starterCampaign', descriptionKey: 'starterCampaignDescription' },
  { id: 'product-discovery', icon: '◇', labelKey: 'starterProductDiscovery', descriptionKey: 'starterProductDiscoveryDescription' },
] as const;

function modalityStarterPrompt(id: string, label: string, tagline: string): string {
  if (id === 'evermind') return 'Create an Evermind dataset, tokenizer, tuning, evaluation, and telemetry pipeline on this Canvas.';
  return `Create a ${label} in this Canvas. ${tagline}`;
}

/**
 * Starting something new — the other half of the Create destination from
 * `DashboardCreationSessions`, which browses what already exists. Two panels
 * with nothing in common but a stylesheet, so they are two files.
 */
export function DashboardCreationLauncher() {
  const t = useTranslations('creationCanvas');
  const modalities = useLocalizedModalities();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [sessionQuota, setSessionQuota] = useState<{ usage: number; limit: number } | null>(null);

  useEffect(() => { void creationSessionsApi.quotas().then((result) => setSessionQuota({ usage: result.usage.sessions, limit: result.limits.sessions })).catch(() => undefined); }, []);
  const sessionLimitReached = !!sessionQuota && sessionQuota.limit !== -1 && sessionQuota.usage >= sessionQuota.limit;

  const createBlank = async () => {
    if (creating || sessionLimitReached) return;
    setCreating(true);
    try {
      const result = await creationSessionsApi.create({ title: t('untitledSession') });
      router.push(`/create/${result.session.id}`);
    } finally { setCreating(false); }
  };

  const startTemplate = async (name: string, initialPrompt: string) => {
    if (creating || sessionLimitReached) return;
    setCreating(true);
    try { const result = await creationSessionsApi.create({ title: name, initialPrompt }); router.push(`/create/${result.session.id}`); }
    finally { setCreating(false); }
  };

  return <section className={styles.launcher} aria-labelledby="creation-launcher-title">
    <div className={styles.launcherHeader}>
      <span className={styles.eyebrow}>{t('launcherEyebrow')}</span>
      <h2 id="creation-launcher-title">{t('createTypeTitle')}</h2>
      <p>{t('createTypeSubtitle')}</p>
    </div>

    <div className={styles.creationPaths}>
      <section className={`${styles.creationPath} ${styles.typePath}`} aria-labelledby="create-by-type-title">
        <div className={styles.pathHeader}>
          <span className={styles.step}>1</span>
          <div><h3 id="create-by-type-title">{t('createByTypeTitle')}</h3><p>{t('createByTypeSubtitle')}</p></div>
        </div>
        <div className={styles.typeGrid} aria-label={t('createByTypeTitle')}>
          {modalities.map((modality) => <button key={modality.id} type="button" disabled={creating || sessionLimitReached || !!modality.comingSoon} onClick={() => void startTemplate(modality.label, modalityStarterPrompt(modality.id, modality.label, modality.tagline))} className={styles.typeCard}>
            <span className={styles.typeIcon} aria-hidden><Icon source={modality.icon} size={20} /></span>
            <span className={styles.cardCopy}><strong>{modality.label}</strong><span>{modality.tagline}</span></span>
            <span className={styles.cardAction} aria-hidden>{modality.comingSoon ? t('comingSoon') : t('createAction')} <b>→</b></span>
          </button>)}
        </div>
      </section>

      <section className={`${styles.creationPath} ${styles.templatePath}`} aria-labelledby="create-from-template-title">
        <div className={styles.pathHeader}>
          <span className={styles.step}>2</span>
          <div><h3 id="create-from-template-title">{t('guidedTemplateTitle')}</h3><p>{t('guidedTemplateSubtitle')}</p></div>
        </div>
        <div className={styles.templateGrid} aria-label={t('guidedTemplatesLabel')}>
          {CANVAS_STARTERS.map((starter) => { const label = t(starter.labelKey); const description = t(starter.descriptionKey); return <button key={starter.id} type="button" disabled={creating || sessionLimitReached} onClick={() => void startTemplate(label, description)} className={styles.templateCard}>
            <span className={styles.templateIcon} aria-hidden><Icon source={starter.icon} size={20} /></span>
            <span className={styles.cardCopy}><strong>{label}</strong><span>{description}</span></span>
            <span className={styles.templateAction}>{t('useTemplate')} <b aria-hidden>→</b></span>
          </button>; })}
        </div>
        <button type="button" onClick={createBlank} disabled={creating || sessionLimitReached} className={styles.blankButton}>
          <span><b aria-hidden><Icon source="＋" size="1em" /></b> {t('blankCanvas')}</span><span aria-hidden>→</span>
        </button>
      </section>
    </div>
    {sessionLimitReached && <p role="alert" className={styles.quotaWarning}>{t('sessionLimitReached')}</p>}
  </section>;
}
