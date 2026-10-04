/*
 * No `'use client'` here, for the reason `CanvasAppSurface.tsx` gives: it is imported only
 * from inside the `CreationCanvas` client boundary.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { hasCodeWorkspace } from '@/lib/canvasBuildTools';
import { useLocalizedModalities } from '@/lib/useModalityCopy';
import type { ProjectModality } from '@/lib/modality';
import styles from './CreationCanvas.module.css';

/**
 * The App surface before the session has an app: pick what you are making, and a real
 * project — files, a runtime, a database once there is an account — is created and stays
 * attached to this board. Asking Brain does the same thing, so the chooser says so.
 *
 * The kinds are the modality registry's, already localized. A board with no account can
 * only run the code kinds, because the studios (Evermind, fine-tune, voice) need a
 * project behind them; it is offered exactly those rather than doors that would fail.
 */
export function CanvasAppStart({ durable, onCreate }: {
  /** Whether the board has an account behind it. */
  durable: boolean;
  onCreate: (modality: ProjectModality) => Promise<void>;
}) {
  const t = useTranslations('creationCanvas.surface.app.start');
  const modalities = useLocalizedModalities().filter((modality) => !modality.comingSoon && (durable || hasCodeWorkspace(modality.id)));
  const [creating, setCreating] = useState<ProjectModality | null>(null);
  const [failed, setFailed] = useState(false);

  const create = (modality: ProjectModality) => {
    setCreating(modality);
    setFailed(false);
    onCreate(modality)
      .catch(() => setFailed(true))
      .finally(() => setCreating(null));
  };

  return (
    <div className={styles.appStart} role="region" aria-label={t('title')}>
      <strong>{t('title')}</strong>
      <p>{durable ? t('body') : t('bodyLocal')}</p>
      <div className={styles.appStartKinds}>
        {modalities.map((modality) => (
          <button key={modality.id} type="button" disabled={creating !== null} onClick={() => create(modality.id)} aria-busy={creating === modality.id}>
            <span aria-hidden><Icon source={modality.icon} size={18} /></span>
            <b>{modality.label}</b>
            <small>{creating === modality.id ? t('creating') : modality.tagline}</small>
          </button>
        ))}
      </div>
      {failed && <p role="alert" className={styles.appStartError}>{t('failed')}</p>}
      <p className={styles.appStartHint}>{t('askBrain')}</p>
    </div>
  );
}
