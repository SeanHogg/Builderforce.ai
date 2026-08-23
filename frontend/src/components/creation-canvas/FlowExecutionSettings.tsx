// No 'use client': rendered only inside `CreationNode.tsx`'s client boundary.
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/**
 * WHAT A RUN WOULD DO — where it runs, and whether it may run unattended.
 *
 * ── WHY IT IS ITS OWN COMPONENT ──────────────────────────────────────────────────
 * This pair was drawn inside `WorkflowBody`, on the `workflow` CARD. The card has since
 * become what it always stood for — a `frame` bounding real `flowStep` objects — and
 * `creationObjectRegistry` moved `approvalMode`/`runTarget` onto `frame` so the execution
 * settings travel with the section. Nothing moved the READOUT, so a board that had been
 * unpacked showed a section with no execution target and no approval mode: the two facts
 * that decide what pressing Run does, on the object Run acts on, absent.
 *
 * Two objects now carry the same two fields, so the readout is one component rather than
 * a second copy — a legacy card and a section must never disagree about what "Fully
 * autonomous" means or where it is drawn.
 *
 * ── IT DECIDES ITS OWN VISIBILITY ────────────────────────────────────────────────
 * A frame is usually just a bounding box: most sections group cards and have nothing to
 * do with running anything, and captioning them "Execution target: BuilderForce.AI" would
 * invent a fact about a rectangle. So it renders NOTHING unless the object actually
 * carries one of the fields — no `isFlow` boolean handed down from the node, which the
 * caller would have to compute and could get wrong.
 *
 * The DEFAULTS only apply once one of them is present, and that asymmetry is deliberate:
 * a flow with a target and no stated approval mode really is "Approval required" (the
 * safe reading), but a plain frame has neither, and silence is the honest answer there.
 */
export function FlowExecutionSettings({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const hasTarget = typeof data.runTarget === 'string' && data.runTarget !== '';
  const hasApproval = typeof data.approvalMode === 'string' && data.approvalMode !== '';
  if (!hasTarget && !hasApproval) return null;

  const target = data.runTarget === 'campaign-strategist' ? 'Campaign Strategist' : 'BuilderForce.AI';
  const approval = data.approvalMode === 'autonomous' ? t('fullyAutonomous') : t('approvalRequired');
  return (
    <div className={styles.widgetSettings}>
      <span><small>{t('executionTarget')}</small><b>{target}</b></span>
      <span><small>{t('approvalMode')}</small><b>{approval}</b></span>
    </div>
  );
}
