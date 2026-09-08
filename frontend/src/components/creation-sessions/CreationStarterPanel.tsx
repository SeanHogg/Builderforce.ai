'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useLocalizedModalities } from '@/lib/useModalityCopy';
import { Icon } from '@/components/ui/Icon';
import { useCreateCanvas } from './useCreateCanvas';
import styles from './CreationLibrary.module.css';

/**
 * WAYS TO START — one list, because starting is one act.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────────
 * This panel used to be two numbered steps. Step 1, "Create by type", offered the
 * modalities. Step 2, "Use a guided template", offered two templates and, underneath
 * them, a blank canvas. The numbering said they were a sequence — pick a type, THEN a
 * template — which was never true: they are alternatives, and picking any one of them
 * did exactly the same thing.
 *
 * That thing is: create a session, and open it with a prompt already in it. A
 * "website", a "campaign studio" and a blank board differ in the OPENING PROMPT and in
 * nothing else. There is no website mode, no template mode, no per-kind editor — the
 * board that opens is the same board, which is the whole premise of the canvas. So the
 * kind is a starter's DATA, and the panel is one grid of starters.
 *
 * The blank canvas leads, as the zero-prompt case, for the same reason chat leads the
 * surface registry as the zero-object case: it is the one everybody already knows how
 * to use, and everything below it is that same board with an opening request attached.
 */

/** The guided starts. A template is a starter with a longer prompt — nothing more,
 *  which is why it is an entry in the same list rather than a second section. */
const CANVAS_TEMPLATES = [
  { id: 'campaign-studio', icon: '◎', labelKey: 'starterCampaign', descriptionKey: 'starterCampaignDescription' },
  { id: 'product-discovery', icon: '◇', labelKey: 'starterProductDiscovery', descriptionKey: 'starterProductDiscoveryDescription' },
] as const;

/** What a modality's board opens by asking for. Evermind names its own pipeline
 *  because "create an Evermind" does not say what the board should contain. */
function modalityStarterPrompt(id: string, label: string, tagline: string): string {
  if (id === 'evermind') return 'Create an Evermind dataset, tokenizer, tuning, evaluation, and telemetry pipeline on this Canvas.';
  return `Create a ${label} in this Canvas. ${tagline}`;
}

interface Starter {
  id: string;
  icon: string;
  label: string;
  tagline: string;
  /** The request the new board opens with. Null is the blank canvas. */
  prompt: string | null;
  comingSoon?: boolean;
}

export function CreationStarterPanel() {
  const t = useTranslations('creationCanvas');
  const modalities = useLocalizedModalities();
  const create = useCreateCanvas();

  const starters = useMemo<Starter[]>(() => [
    { id: 'blank', icon: '＋', label: t('blankCanvas'), tagline: t('blankCanvasTagline'), prompt: null },
    ...modalities.map((modality) => ({
      id: modality.id,
      icon: modality.icon,
      label: modality.label,
      tagline: modality.tagline,
      prompt: modalityStarterPrompt(modality.id, modality.label, modality.tagline),
      comingSoon: modality.comingSoon,
    })),
    ...CANVAS_TEMPLATES.map((template) => ({
      id: template.id,
      icon: template.icon,
      label: t(template.labelKey),
      tagline: t(template.descriptionKey),
      prompt: t(template.descriptionKey),
    })),
  ], [modalities, t]);

  const start = (starter: Starter) => {
    if (starter.prompt === null) return void create.createBlank();
    void create.createFrom(starter.label, starter.prompt);
  };

  return (
    <section className={styles.launcher} aria-labelledby="creation-starters-title">
      <div className={styles.launcherHeader}>
        <span className={styles.eyebrow}>{t('launcherEyebrow')}</span>
        <h2 id="creation-starters-title">{t('createTypeTitle')}</h2>
        <p>{t('createTypeSubtitle')}</p>
      </div>

      <div className={styles.starterGrid} aria-label={t('startersLabel')}>
        {starters.map((starter) => (
          <button
            key={starter.id}
            type="button"
            className={styles.starterCard}
            data-blank={starter.prompt === null ? 'true' : undefined}
            disabled={create.creating || create.limitReached || !!starter.comingSoon}
            onClick={() => start(starter)}
          >
            <span className={styles.starterIcon} aria-hidden><Icon source={starter.icon} size={20} /></span>
            <span className={styles.cardCopy}>
              <strong>{starter.label}</strong>
              <span>{starter.tagline}</span>
            </span>
            <span className={styles.cardAction} aria-hidden>
              {starter.comingSoon ? t('comingSoon') : t('createAction')} <b>→</b>
            </span>
          </button>
        ))}
      </div>

      {create.limitReached && <p role="alert" className={styles.quotaWarning}>{t('sessionLimitReached')}</p>}
    </section>
  );
}
