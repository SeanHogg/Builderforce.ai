// No 'use client': rendered only inside `CreationCanvas`'s client boundary.
import { useTranslations } from 'next-intl';
import { stepKindOf } from '@/domains/workflow/domain/flowStepObject';
import { hasBuildNodes, EVERMIND_BUILD_TEMPLATES } from '@/lib/evermindBuild';
import type { CreationFlowNode } from './CreationNode';
import styles from './CreationCanvas.module.css';

/**
 * WHAT A FRAME HOLDS, WHEN WHAT IT HOLDS IS A FLOW.
 *
 * A frame is a section of the board, and a section of STEPS is a workflow — so this is
 * where the two things a flow needs that furniture does not are answered:
 *
 *  • How many steps are in it, so "Build flow" is not a button you press to find out.
 *  • Whether any of them are Evermind BUILD steps, which do not run in the cloud at
 *    all: they run in the browser, on this device's GPU, through
 *    `lib/evermindBuild.ts`. That runner had exactly one door — a panel inside the
 *    standalone workflow builder — and when that builder was deleted the door had to
 *    move here rather than the capability being lost with it.
 *
 * The two starting points are offered on an EMPTY frame, because a training pipeline is
 * eight steps nobody wants to place by hand, and a blank section is exactly the moment
 * to say so. They come from the same `EVERMIND_BUILD_TEMPLATES` registry the old panel
 * read, so adding a template still means editing one list.
 *
 * Self-contained: it decides its own visibility from the objects it was given.
 */

export interface FrameFlowSectionProps {
  node: CreationFlowNode;
  /** The objects this frame currently holds, at any depth. */
  members: readonly CreationFlowNode[];
  editable: boolean;
  /** Open the in-browser Evermind build runner over this frame's steps. */
  onOpenEvermindBuild: () => void;
  /** Lay a starting pipeline out inside this frame. */
  onLoadEvermindTemplate: (templateId: 'train-llm' | 'teach-code') => void;
}

export function FrameFlowSection({ node, members, editable, onOpenEvermindBuild, onLoadEvermindTemplate }: FrameFlowSectionProps) {
  const t = useTranslations('creationCanvas.flowStep');
  const tBuild = useTranslations('evermindBuild');
  const steps = members.filter((member) => member.data.kind === 'flowStep');
  const runsInBrowser = hasBuildNodes(steps.map((step) => ({ kind: stepKindOf(step.data) })));

  // A frame that holds no steps at all is ordinary board furniture, except for the one
  // thing worth offering there: a pipeline to start from.
  if (steps.length === 0 && !editable) return null;

  return (
    <section className={styles.flowSection} data-testid="frame-flow-section">
      <h4>{t('framePurpose')}</h4>
      <p>{t('frameHolds', { count: steps.length })}</p>

      {runsInBrowser && (
        <button type="button" className={styles.flowAdd} onClick={onOpenEvermindBuild} data-testid="frame-open-evermind-build">
          {tBuild('title')}
        </button>
      )}

      {steps.length === 0 && editable && EVERMIND_BUILD_TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          className={styles.flowAdd}
          data-testid={`frame-evermind-template-${template.id}`}
          onClick={() => onLoadEvermindTemplate(template.id)}
        >
          {tBuild(template.nameKey as 'templateTrainLlm')}
        </button>
      ))}
      {/* The name a frame carries is what the built definition is called, so it is worth
          saying out loud here rather than leaving somebody to discover it after a build. */}
      <p>{t('flowNamedAfterFrame', { name: node.data.title })}</p>
    </section>
  );
}
