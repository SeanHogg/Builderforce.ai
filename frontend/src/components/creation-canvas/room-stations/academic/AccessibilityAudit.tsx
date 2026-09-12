import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { accessibilityVerdict, auditAccessibility, auditsKind, type A11yFinding } from '@/lib/academic/accessibility';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import type { RoomStationModel, RoomStationView } from '../types';
import { AcademicFace } from './AcademicFace';
import { useAcademicBoard } from './academicBoard';
import styles from './academicStations.module.css';

/**
 * THE ACCESSIBILITY AUDIT — every artifact on the board checked against WCAG and
 * against the needs of the cohort actually on it (`auditAccessibility`).
 *
 * Blockers first, because that is the order the engine returns and the order the list
 * exists to be worked in; each names its WCAG criterion verbatim, because that is what
 * a complaint quotes. The score is `accessibilityVerdict`'s, where a blocker costs three
 * warnings — a board with one uncaptioned lecture for a deaf student is not "mostly fine".
 *
 * Entitlement: anyone on the board sees what is inaccessible — an author and a learner
 * both need to know a video has no captions. WHICH accommodation raised a finding to a
 * blocker names a learner, so that line is staff only.
 */

function useAudit() {
  const { board, nodes, staff } = useAcademicBoard();
  const findings = useMemo(() => auditAccessibility(nodes), [nodes]);
  const audited = useMemo(() => nodes.filter((node) => auditsKind(String(node.data.kind ?? ''))).length, [nodes]);
  const verdict = useMemo(() => accessibilityVerdict(findings, audited), [findings, audited]);
  return { board, findings, verdict, audited, staff };
}

function useFindingName() {
  const tCanvas = useTranslations('creationCanvas');
  return (finding: A11yFinding) => finding.title || tCanvas(`object.${finding.kind}` as never);
}

function useAccessibilityModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.accessibility');
  const nameOf = useFindingName();
  const { board, findings, verdict, audited } = useAudit();
  if (!board || !audited) return null;
  return {
    title: t('title'),
    summary: t('summary', { score: verdict.score }),
    face: (
      <AcademicFace
        figure={String(verdict.score)}
        headline={verdict.distributable ? t('distributable') : t('blocked', { count: verdict.blockers })}
        lines={findings.slice(0, 3).map((finding) => `${nameOf(finding)} · ${t(`code.${finding.code}`)}`)}
        tone={verdict.distributable ? 'calm' : 'attention'}
      />
    ),
  };
}

function AccessibilityAuditPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.accessibility');
  const nameOf = useFindingName();
  const { board, findings, verdict, audited, staff } = useAudit();
  if (!board || !audited) return null;

  return (
    <div className={styles.panel} data-testid="accessibility-audit-panel">
      <p className={styles.banner} role="status" data-tone={verdict.distributable ? 'calm' : 'attention'}>
        {verdict.distributable ? t('distributable') : t('blocked', { count: verdict.blockers })}
        {verdict.warnings > 0 ? ` · ${t('warnings', { count: verdict.warnings })}` : ''}
      </p>
      <div
        className={styles.meter}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={verdict.score}
        aria-label={t('scoreLabel')}
        data-tone={verdict.distributable ? 'calm' : 'attention'}
      >
        <span className={styles.meterFill} style={{ width: `${verdict.score}%` }} aria-hidden="true" />
        <span className={styles.meterText}>{t('score', { score: verdict.score })}</span>
      </div>
      {findings.length ? (
        <ul className={styles.rows} aria-label={t('findingsLabel')}>
          {findings.map((finding) => (
            <li key={`${finding.objectId}-${finding.code}`} className={styles.rowItem} data-tone={finding.severity === 'blocker' ? 'attention' : 'calm'} data-testid="a11y-finding">
              <span>
                <span className={styles.badge} data-tone={finding.severity === 'blocker' ? 'attention' : 'calm'}>{t(`severity.${finding.severity}`)}</span>
                <strong>{nameOf(finding)}</strong>
              </span>
              <span>{t(`code.${finding.code}`)} · {t('criterion', { criterion: finding.criterion })}</span>
              {staff && finding.raisedBy && <span className={styles.line}>{t('raisedBy', { source: finding.raisedBy })}</span>}
            </li>
          ))}
        </ul>
      ) : <p className={styles.line}>{t('none')}</p>}
    </div>
  );
}

export const accessibilityAuditView: RoomStationView = {
  useModel: () => useAccessibilityModel(),
  Panel: AccessibilityAuditPanel,
};
