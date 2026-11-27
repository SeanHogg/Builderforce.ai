/*
 * No `'use client'` here, for the reason `CanvasAppSurface.tsx` gives: it is imported only
 * from inside the `CreationCanvas` client boundary.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { hasCodeWorkspace } from '@/lib/canvasBuildTools';
import { useLocalizedModalities } from '@/lib/useModalityCopy';
import { useCanvasProjectStarters } from '@/lib/useCanvasProjectStarters';
import type { CanvasProjectStarter } from '@builderforce/ide-templates/project-types';
import type { ProjectModality } from '@/lib/modality';
import styles from './styles/surfaces.module.css';

/**
 * The App surface before the session has an app: pick what you are making, and a real
 * project — files, a runtime, a database once there is an account — is created and stays
 * attached to this board. Asking Brain does the same thing, so the chooser says so.
 *
 * The kinds are the modality registry's, already localized. A board with no account can
 * run code in the browser. Other starters can open a local editing surface on the board.
 */
export function CanvasAppStart({ durable, onCreate, onStartProject }: {
  /** Whether the board has an account behind it. */
  durable: boolean;
  onCreate: (modality: ProjectModality) => Promise<void>;
  onStartProject?: (kind: CanvasProjectStarter['kind'], title: string) => void;
}) {
  const t = useTranslations('creationCanvas.surface.app.start');
  const modalities = useLocalizedModalities().filter((modality) => !modality.comingSoon && (durable || hasCodeWorkspace(modality.id)));
  const projectStarters = useCanvasProjectStarters();
  const [creating, setCreating] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const choices = [
    ...modalities.map((modality) => ({ ...modality, run: () => onCreate(modality.id) })),
    ...(onStartProject ? projectStarters.map((starter) => ({
      ...starter,
      run: () => onStartProject(starter.kind, starter.label),
    })) : []),
  ];

  const create = async (choice: (typeof choices)[number]) => {
    setCreating(choice.id);
    setFailed(false);
    try {
      await choice.run();
    } catch {
      setFailed(true);
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className={styles.appStart} role="region" aria-label={t('title')}>
      <strong>{t('title')}</strong>
      <p>{durable ? t('body') : t('bodyLocal')}</p>
      <div className={styles.appStartKinds}>
        {choices.map((choice) => (
          <button key={choice.id} type="button" disabled={creating !== null} onClick={() => void create(choice)} aria-busy={creating === choice.id}>
            <span aria-hidden><Icon source={choice.icon} size={18} /></span>
            <b>{choice.label}</b>
            <small>{creating === choice.id ? t('creating') : choice.tagline}</small>
          </button>
        ))}
      </div>
      {failed && <p role="alert" className={styles.appStartError}>{t('failed')}</p>}
      <p className={styles.appStartHint}>{t('askBrain')}</p>
    </div>
  );
}
