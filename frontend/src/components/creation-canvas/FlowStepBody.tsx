// No 'use client': rendered only inside `CreationNode.tsx`'s client boundary.
import { useTranslations } from 'next-intl';
import { Handle, Position } from '@xyflow/react';
import { configSummary, nodeKindBlurb, NODE_GROUP_KEYS, NODE_KIND_MAP } from '@/domains/workflow/domain/stepCatalog';
import { stepConfigOf, stepInputsOf, stepKindOf, stepOutputsOf } from '@/domains/workflow/domain/flowStepObject';
import { isMultiOutletKind, stepOutlets } from '@/domains/workflow/domain/stepOutlets';
import { integrationForConfig } from '@/domains/workflow/domain/stepIntegrations';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/**
 * ONE EXECUTABLE STEP, DRAWN ON THE BOARD.
 *
 * ── WHY THE OUTLETS ARE AT THE BOTTOM ────────────────────────────────────────
 * Every object on this board has one connection point on each side: in on the
 * left, on to the right. That is the right shape for "and then", and it is the
 * wrong shape for a decision — a switch with five cases had ONE dot, so every arm
 * left from the same place and which case went where existed only in the author's
 * head (and in a `filter` step on each arm re-testing what the switch had already
 * decided).
 *
 * A step that decides draws its outlets along the BOTTOM, one per case, each
 * named and separately connectable. Bottom rather than a stack on the right
 * because the arms of a decision are siblings and reading them as a row says so;
 * and because keeping the right-hand edge free would invite an "and then" out of a
 * node that has no unconditional continuation. Such a step therefore renders NO
 * right-hand handle — see `CreationNode`, which asks this module's own predicate.
 *
 * ── WHAT THE CARD SAYS ───────────────────────────────────────────────────────
 * The family (Flow Control, Tools, AI Agents …), the one line of config that
 * identifies the call (`twilio · send_sms`, `openai · gpt-4o`) and the two data
 * contracts the author declared. The summary comes from the catalog rather than
 * from here, so the canvas card, the builder node, the 3D card and the inspector
 * cannot describe the same step four ways.
 *
 * Self-contained: it takes the object's data and edits nothing. Everything it
 * needs to draw is derivable from that data plus the catalog.
 */

/** Whether this step's continuation is a set of NAMED outlets rather than one
 *  unconditional "and then". Asked by the card renderer to decide whether to draw
 *  its own right-hand source handle. */
export function flowStepHasNamedOutlets(data: CreationNodeData): boolean {
  return data.kind === 'flowStep' && isMultiOutletKind(stepKindOf(data));
}

export function FlowStepBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas');
  const tStep = useTranslations('evermindBuild');
  const stepKind = stepKindOf(data);
  const config = stepConfigOf(data);
  const meta = NODE_KIND_MAP[stepKind];
  const integration = integrationForConfig(config);
  const summary = configSummary(stepKind, config);
  const inputs = stepInputsOf(data);
  const outputs = stepOutputsOf(data);
  const named = isMultiOutletKind(stepKind);

  return (
    <div className={styles.flowStep}>
      <div className={styles.flowStepFamily} data-testid="flow-step-family">
        {meta ? tStep(`nodeGroup.${NODE_GROUP_KEYS[meta.group]}`) : stepKind}
      </div>
      <p className={styles.flowStepSummary}>
        {summary || (meta ? nodeKindBlurb(meta, tStep) : '')}
      </p>
      {integration && <span className={styles.flowStepChip} data-tone="integration">{integration.label}</span>}

      {(inputs.length > 0 || outputs.length > 0) && (
        <dl className={styles.flowStepContract}>
          {inputs.length > 0 && (
            <div>
              <dt>{t('flowStep.dataIn')}</dt>
              <dd>{inputs.map((binding) => binding.key).join(' · ')}</dd>
            </div>
          )}
          {outputs.length > 0 && (
            <div>
              <dt>{t('flowStep.dataOut')}</dt>
              <dd>{outputs.map((output) => output.key).join(' · ')}</dd>
            </div>
          )}
        </dl>
      )}

      {named && <FlowStepOutletRail data={data} />}
    </div>
  );
}

/**
 * The decision, drawn: one connection point per outlet, in the order the executor
 * evaluates them, with the fallback marked as the last resort it is.
 *
 * Its own component because a step is drawn at two densities and BOTH have to offer
 * the outlets. A minimized step that fell back to the generic right-hand handle would
 * let an author draw an unlabeled arm out of a switch — an arm the executor never
 * prunes, so every case would run — which is precisely the failure outlets exist to
 * end. Zooming out must not change what a connection means.
 */
export function FlowStepOutletRail({ data }: { data: CreationNodeData }) {
  const config = stepConfigOf(data);
  const outlets = stepOutlets(stepKindOf(data), config);
  return (
    <div className={styles.flowStepOutlets} data-testid="flow-step-outlets">
      {outlets.map((outlet) => (
        <span key={outlet.id} className={styles.flowStepOutlet} data-fallback={outlet.fallback ? 'true' : undefined}>
          <b>{outlet.name}</b>
          {(outlet.condition || outlet.match) && <small>{outlet.condition || outlet.match}</small>}
          <Handle
            type="source"
            id={outlet.id}
            position={Position.Bottom}
            className={styles.flowStepOutletHandle}
            data-testid={`flow-step-outlet-${outlet.id}`}
          />
        </span>
      ))}
    </div>
  );
}
