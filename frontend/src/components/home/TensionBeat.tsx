'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { HomeSection, HomeSectionHeader } from './HomePatterns';
import styles from './TensionBeat.module.css';

type WorkflowStep = { title: string; desc: string };

/**
 * The problem and the cure, presented as one continuous argument.
 *
 * The page used to open on the solution and never name the tension, so a visitor
 * who did not already feel tool sprawl was being sold a fix for something they
 * had not been told they had — the single largest conversion gap in the old
 * narrative.
 *
 * The claim is not new copy invented for this section: it is the product's own
 * positioning, which already says "the work begins before the code" and
 * "without stitching together a board, a code host, an observability tool, and a
 * spreadsheet". This makes that argument explicit and gives it a picture — five
 * fragments with the connections visibly severed, resolving into one surface.
 * The broken links ARE the argument, which is why they carry the accent. The
 * resolved canvas then flows directly into the only numbered sequence on the
 * homepage, so the visitor sees how the promise becomes an outcome.
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
        <div className={styles.diagram}>
          <div className={styles.fragments} role="img" aria-label={t('home.tension.diagramAlt')}>
            {fragments.map((fragment, index) => (
              <Fragment key={fragment}>
                {index > 0 && <span className={styles.break} aria-hidden="true" />}
                <span className={styles.fragment}>{fragment}</span>
              </Fragment>
            ))}
          </div>
          <span className={styles.joinArrow} aria-hidden="true">↓</span>
          <div className={styles.canvasBar}>
            <span aria-hidden="true">✦</span>
            {t('home.tension.canvasLabel')}
          </div>
        </div>

        <p className={styles.resolve}>{t.rich('home.tension.resolve', { em: (chunks) => <em>{chunks}</em> })}</p>

        <div className={styles.workflow} id="how-it-works">
          <header className={styles.workflowHeader}>
            <span className={styles.eyebrow}>{t('home.beat.howItWorks')}</span>
            <h2>{t('home.stepsHeading')}</h2>
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
