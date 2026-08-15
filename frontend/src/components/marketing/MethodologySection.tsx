'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import {
  LOOP_CLOSES_IN,
  METHOD_STAGES,
  METHOD_STEP_SPECS,
  methodStepKey,
  proofFormKey,
  proofsByCost,
} from '@/lib/methodology';
import styles from './MethodologySection.module.css';

/**
 * The ONE renderer for "Idea to Real".
 *
 * Four marketing surfaces need to say the same thing about how the product
 * works — `/features` ("what is this"), `/about` ("why does it exist"),
 * `/pricing` ("what am I buying") and `/sell-builderforce` ("what am I
 * selling"). They had four different answers, and none of them named the
 * method. Four retellings is four chances to drift, so there is one component
 * and the pages choose how much of it to show.
 *
 * It is a CLIENT component on purpose: two of the four hosts are client pages
 * and two are server pages, and `useTranslations` is the only translation API
 * that works under both. The cost is a small island on two static pages; the
 * alternative is two copies of the same markup, which is the thing this exists
 * to prevent.
 *
 * Every colour is a token and every track is fluid — the proof grid is
 * `auto-fit`/`minmax`, so it goes from four columns to one without a breakpoint
 * and without the page ever scrolling sideways.
 */

/**
 * How much of the method to show. Chosen by what the HOST already renders, not
 * by how important the page is: `/features` carries the registry-generated arc
 * table a few bands further down, and two renderings of the same arc on one
 * page is the drift this component exists to prevent, in miniature.
 */
export type MethodologyVariant =
  /** Loop + arc + all eight proofs. Nothing else on the page says any of it. */
  | 'full'
  /** Loop + proofs, no arc strip — the host renders the arc itself. */
  | 'catalog'
  /** Loop + arc only. For pages whose subject is not the proof catalogue. */
  | 'loop';

/** A five-dot meter. Fidelity and effort are the two axes the choice turns on,
 *  and a count out of five reads faster than a word. Mirrors the control the
 *  product itself uses on `/realize`. */
function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className={styles.meter}>
      <span className={styles.meterLabel}>{label}</span>
      <span className={styles.meterDots} role="img" aria-label={`${label}: ${value} of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={styles.meterDot} data-on={n <= value} />
        ))}
      </span>
    </span>
  );
}

export default function MethodologySection({
  variant = 'full',
  headingLevel = 'h2',
}: {
  variant?: MethodologyVariant;
  /** So a host page can slot this under its own <h1> without skipping a level. */
  headingLevel?: 'h2' | 'h3';
}) {
  const t = useTranslations('methodology');
  const tn = useTranslations('nav');
  const Heading = headingLevel;

  // The loop is the method; every variant shows it. The arc and the catalogue
  // are the two halves a host may already own.
  const showArc = variant === 'full' || variant === 'loop';
  const showProofs = variant === 'full' || variant === 'catalog';

  return (
    <div className={styles.root} data-variant={variant}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <Heading className={styles.title}>{t('title')}</Heading>
        <p className={styles.lede}>{t('lede')}</p>
      </header>

      {/* ── The loop: three acts, and the middle one is the opinion ─────────── */}
      <ol className={styles.steps}>
        {METHOD_STEP_SPECS.map((step, index) => (
          <li
            key={step.id}
            className={styles.step}
            style={{ '--step-hue': `var(${step.hueVar})` } as React.CSSProperties}
          >
            <span className={styles.stepTop}>
              <span className={styles.stepIcon} aria-hidden="true"><Icon source={step.icon} size={20} /></span>
              <span className={styles.stepIndex}>{String(index + 1).padStart(2, '0')}</span>
            </span>
            <h3 className={styles.stepTitle}>{t(methodStepKey(step.id, 'title'))}</h3>
            <p className={styles.stepQuestion}>{t(methodStepKey(step.id, 'question'))}</p>
            <p className={styles.stepBody}>{t(methodStepKey(step.id, 'body'))}</p>
            <span className={styles.stepCost} data-spends={step.spends}>
              {step.spends ? t('spends.yes') : t('spends.no')}
            </span>
          </li>
        ))}
      </ol>

      {showArc && (
        /* ── The arc the loop sits inside, and where it closes ─────────────── */
        <div className={styles.arc}>
          <p className={styles.arcHead}>{t('arcHead')}</p>
          <ol className={styles.arcRow}>
            {METHOD_STAGES.map((stage) => (
              <li
                key={stage}
                className={styles.arcStage}
                data-closes={stage === LOOP_CLOSES_IN}
                style={{ '--step-hue': `var(--stage-${stage})` } as React.CSSProperties}
              >
                <span className={styles.arcDot} aria-hidden="true" />
                <strong>{tn(`stage.${stage}`)}</strong>
                <em>{t(`arcQuestion.${stage}`)}</em>
              </li>
            ))}
          </ol>
          <p className={styles.arcNote}>{t('arcNote')}</p>
        </div>
      )}

      {showProofs && (
        <div className={styles.proofs}>
          <p className={styles.proofsHead}>{t('proofsHead')}</p>
          <p className={styles.proofsLede}>{t('proofsLede')}</p>
          <ul className={styles.proofGrid}>
            {proofsByCost().map((proof) => (
              <li key={proof.key} className={styles.proof}>
                <span className={styles.proofTop}>
                  <strong>{t(proofFormKey(proof.key, 'name'))}</strong>
                  {proof.live && <span className={styles.proofLive}>{t('liveBadge')}</span>}
                </span>
                <p className={styles.proofQuestion}>{t(proofFormKey(proof.key, 'question'))}</p>
                <p className={styles.proofSummary}>{t(proofFormKey(proof.key, 'summary'))}</p>
                <span className={styles.proofMeters}>
                  <Meter value={proof.fidelity} label={t('fidelity')} />
                  <Meter value={proof.effort} label={t('effort')} />
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.proofsNote}>{t('proofsNote')}</p>
        </div>
      )}

      <div className={styles.actions}>
        <Link href="/realize" className={styles.cta}>{t('ctaRealize')}</Link>
        <Link href="/create/new" className={styles.ctaGhost}>{t('ctaCanvas')}</Link>
      </div>
    </div>
  );
}
