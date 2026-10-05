// No 'use client' directive: rendered only inside `CreationCanvas`, which declares it.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCanvasPhase, useLetBrain } from './CanvasPhaseContext';
import styles from '../CreationCanvas.module.css';

/**
 * THE PATH — what an unready phase is missing, and the shortest way there.
 *
 * Pressing Measure on a board with nothing live used to open Measure and say nothing.
 * This says what is missing in plain words, numbers the steps (one per missing
 * requirement, in arc order) and gives the first one two presses: go to the phase that
 * satisfies it, or have Brain do it. It is never a lock — every surface behind it still
 * works — so it folds to a one-line chip for somebody who knows and wants the room.
 *
 * The fold lives in memory only, never in storage: a returning reader always sees what
 * is still missing. Reach's metric ADVISORY renders as a single warning-tone line: going
 * out without a metric is allowed, but the canvas says it is spending blind.
 *
 * Self-contained: it reads the phase from `CanvasPhaseContext` and returns null when
 * there is nothing to say.
 */
export function CanvasPhasePath() {
  const t = useTranslations('creationCanvas');
  const tn = useTranslations('nav');
  const phaseValue = useCanvasPhase();
  const letBrain = useLetBrain();
  const [collapsed, setCollapsed] = useState(false);
  if (!phaseValue || !letBrain) return null;
  const { phase, current, setPhase } = phaseValue;
  if (current.ready && current.advisories.length === 0) return null;
  const stage = (id: string) => tn(`stage.${id}` as 'stage.idea');
  const toggleLabel = collapsed ? t('phasePath.expand') : t('phasePath.collapse');

  if (current.ready) {
    const advisory = current.advisories[0]!;
    return (
      <div className={styles.phasePath} role="status" data-tone="warning" data-testid="canvas-phase-path">
        <p className={styles.phasePathAdvisory}>{t(`requirement.${advisory.id}.advisory` as 'requirement.metric.advisory')}</p>
        <div className={styles.phasePathActions}>
          <button type="button" className={styles.phasePathButton} onClick={() => setPhase(advisory.satisfiedIn)}>
            {t('phasePath.goTo', { phase: stage(advisory.satisfiedIn) })}
          </button>
        </div>
      </div>
    );
  }

  const first = current.missing[0]!;
  const kicker = t('phasePath.kicker', { phase: stage(phase), count: current.missing.length });
  return (
    <div className={styles.phasePath} role="status" data-collapsed={collapsed ? 'true' : 'false'} data-testid="canvas-phase-path" data-stage={phase}>
      <div className={styles.phasePathHead}>
        <span className={styles.phasePathKicker}>{kicker}</span>
        <button
          type="button"
          className={styles.phasePathToggle}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setCollapsed((value) => !value)}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d={collapsed ? 'M3 4.5l3 3 3-3' : 'M3 7.5l3-3 3 3'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {!collapsed && <>
        <strong className={styles.phasePathTitle}>{t(`phaseGate.${phase}.title` as 'phaseGate.make.title')}</strong>
        <p className={styles.phasePathBody}>{t(`phaseGate.${phase}.body` as 'phaseGate.make.body')}</p>
        <ol className={styles.phasePathSteps}>
          {current.missing.map((requirement) => (
            <li key={requirement.id} data-testid="canvas-phase-path-step">
              <span>{t(`requirement.${requirement.id}.label` as 'requirement.idea.label')}</span>
              {requirement === first && <div className={styles.phasePathActions}>
                <button type="button" className={styles.phasePathButton} onClick={() => setPhase(requirement.satisfiedIn)}>
                  {t('phasePath.goTo', { phase: stage(requirement.satisfiedIn) })}
                </button>
                <button type="button" className={styles.phasePathButton} data-primary="true" onClick={() => letBrain.askRequirement(requirement.id)}>
                  {t('phasePath.letBrain', { verb: letBrain.requirementVerb(requirement.id) })}
                </button>
              </div>}
            </li>
          ))}
        </ol>
      </>}
    </div>
  );
}
