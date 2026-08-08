'use client';

import { useTranslations } from 'next-intl';
import { HomeSection, HomeSectionHeader } from './HomePatterns';
import styles from './TensionBeat.module.css';

type WorkflowStep = { title: string; desc: string };

/**
 * The homepage's core promise as a single argument: ideas lose time and context
 * while being handed between tools; Builderforce keeps the journey continuous
 * until the result is real — live in production and ready to use.
 */
export function TensionBeat() {
  const t = useTranslations();
  const fragments = t.raw('home.tension.fragments') as string[];
  const steps = t.raw('home.steps') as WorkflowStep[];

  return (
    <HomeSection id="the-problem" tone="soft">
      <HomeSectionHeader
        eyebrow={t('home.tension.eyebrow')}
        title={t('home.tension.heading')}
        lead={t('home.tension.body')}
      />
      <div className={styles.beat}>
        <div className={styles.diagram} role="img" aria-label={t('home.tension.diagramAlt')}>
          <div className={styles.route} aria-hidden="true">
            <span className={styles.routeLabel}>{t('home.tension.oldWayLabel')}</span>
            <span className={styles.endpoint}>{t('home.tension.ideaLabel')}</span>
            <span className={styles.arrow}>→</span>
            <div className={styles.switching}>
              <div className={styles.fragments}>
                {fragments.map((fragment) => <span className={styles.fragment} key={fragment}>{fragment}</span>)}
              </div>
              <span className={styles.switchCost}>{t('home.tension.switchCost')}</span>
            </div>
            <span className={styles.arrow}>→</span>
            <span className={`${styles.endpoint} ${styles.faded}`}>{t('home.tension.realLabel')}</span>
          </div>

          <div className={`${styles.route} ${styles.builderforceRoute}`} aria-hidden="true">
            <span className={styles.routeLabel}>Builderforce</span>
            <span className={styles.endpoint}>{t('home.tension.ideaLabel')}</span>
            <span className={styles.solidArrow}>→</span>
            <div className={styles.canvasBar}>
              <span>✦</span>
              {t('home.tension.canvasLabel')}
            </div>
            <span className={styles.solidArrow}>→</span>
            <span className={`${styles.endpoint} ${styles.realEndpoint}`}>
              {t('home.tension.realLabel')}
              <small>{t('home.tension.realDefinition')}</small>
            </span>
          </div>
        </div>

        <div className={styles.workflow} id="how-it-works">
          <header className={styles.workflowHeader}>
            <span className={styles.eyebrow}>{t('home.beat.howItWorks')}</span>
            <h2>{t.rich('home.stepsHeading', { em: (chunks) => <em>{chunks}</em> })}</h2>
          </header>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li className={styles.step} key={step.title}>
                <span className={styles.stepNumber}>{String(index + 1).padStart(2, '0')} / 03</span>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </HomeSection>
  );
}
