// No 'use client': rendered only inside `CreationCanvas`'s client boundary.
import { useTranslations } from 'next-intl';
import type { Edge } from '@xyflow/react';
import { StepConfigForm } from '@/domains/workflow/presentation/StepConfigForm';
import {
  stepConfigOf, stepInputsOf, stepKindOf, stepOutputsOf,
  type FlowStepBinding, type FlowStepOutput,
} from '@/domains/workflow/domain/flowStepObject';
import {
  appendOutlet, isMultiOutletKind, outletForHandle, outletPredicate, patchOutlet, removeOutlet, stepOutlets,
} from '@/domains/workflow/domain/stepOutlets';
import { creationObjectName } from './creationObjectRegistry';
import type { CreationFlowNode } from './CreationNode';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/**
 * CONFIGURING A STEP THAT LIVES ON THE BOARD.
 *
 * Four things are asked of a step, and only the first is about the step alone:
 *
 *  1. WHAT IT DOES — its typed config. Shared with the standalone builder
 *     (`StepConfigForm`), because a prompt is a prompt wherever the step is drawn.
 *  2. THE LOGICAL CONNECTION — the named paths out of a decision, each with the
 *     condition or the value that selects it. Editing a path here moves the
 *     connection point on the card, because they are the same thing seen twice
 *     (`stepOutlets.ts` owns the projection).
 *  3. DATA IN — what this step is handed, by name. Lowered by the compiler into a
 *     mapping step in front of this one, so it is a contract and not a note.
 *  4. DATA OUT — what it publishes, by name, for later steps to read.
 *
 * And then CONNECTIONS: what is actually wired to it, which outlet each leaves
 * from, and the ability to cut one — the same question the board answers
 * graphically, answered in words for the cases where the board is too dense to
 * read (and for anyone using a screen reader, for whom the board answers nothing).
 *
 * Self-contained: it derives everything from the object and the board's edges, and
 * writes through ONE `onChange` patch channel. Drop it beside a different board and
 * it needs no edits.
 */

export interface FlowStepInspectorProps {
  nodeId: string;
  data: CreationNodeData;
  nodes: readonly CreationFlowNode[];
  edges: readonly Edge[];
  editable: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
  /** Cut one connection. Absent on a board this viewer may not edit. */
  onRemoveConnection?: (edgeId: string) => void;
  /** Put the reader in front of the object at the other end. */
  onRevealObject?: (nodeId: string) => void;
}

export function FlowStepInspector({
  nodeId, data, nodes, edges, editable, onChange, onRemoveConnection, onRevealObject,
}: FlowStepInspectorProps) {
  const t = useTranslations('creationCanvas');
  const stepKind = stepKindOf(data);
  const config = stepConfigOf(data);
  const inputs = stepInputsOf(data);
  const outputs = stepOutputsOf(data);
  const outlets = stepOutlets(stepKind, config);
  const decides = isMultiOutletKind(stepKind);
  const predicate = outletPredicate(stepKind);

  const patchConfig = (patch: Record<string, unknown>) => onChange({ stepConfig: { ...config, ...patch } });
  const nameOf = (id: string) => {
    const node = nodes.find((candidate) => candidate.id === id);
    return node ? creationObjectName(node.data) : id;
  };

  const incoming = edges.filter((edge) => edge.target === nodeId);
  const outgoing = edges.filter((edge) => edge.source === nodeId);

  const rows = <K extends 'stepInputs' | 'stepOutputs'>(
    key: K,
    list: readonly (FlowStepBinding | FlowStepOutput)[],
    keyLabel: string,
    fromLabel: string,
    fromHint: string,
  ) => (
    <div className={styles.flowRows}>
      {list.map((entry, index) => (
        <div key={`${key}-${index}`} className={styles.flowRow}>
          <label>
            <span>{keyLabel}</span>
            <input
              value={entry.key}
              disabled={!editable}
              onChange={(event) => onChange({ [key]: list.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)) } as Partial<CreationNodeData>)}
            />
          </label>
          <label>
            <span>{fromLabel}</span>
            <input
              value={entry.from}
              placeholder={fromHint}
              disabled={!editable}
              onChange={(event) => onChange({ [key]: list.map((item, i) => (i === index ? { ...item, from: event.target.value } : item)) } as Partial<CreationNodeData>)}
            />
          </label>
          {editable && <button
            type="button"
            aria-label={t('flowStep.removeBinding', { key: entry.key })}
            onClick={() => onChange({ [key]: list.filter((_, i) => i !== index) } as Partial<CreationNodeData>)}
          >×</button>}
        </div>
      ))}
      {editable && <button
        type="button"
        className={styles.flowAdd}
        onClick={() => onChange({ [key]: [...list, { key: '', from: '' }] } as Partial<CreationNodeData>)}
      >{t('flowStep.addBinding')}</button>}
    </div>
  );

  return (
    <div className={styles.flowInspector} data-testid="flow-step-inspector">
      <StepConfigForm kind={stepKind} config={config} onConfigChange={patchConfig} />

      {/* 2. THE LOGICAL CONNECTION. */}
      {decides && (
        <section className={styles.flowSection} data-testid="flow-step-outlet-editor">
          <h4>{t('flowStep.outlets')}</h4>
          <p>{t('flowStep.outletsHint')}</p>
          <div className={styles.flowRows}>
            {outlets.map((outlet) => (
              <div key={outlet.id} className={styles.flowRow} data-fallback={outlet.fallback ? 'true' : undefined}>
                <label>
                  <span>{t('flowStep.outletName')}</span>
                  <input
                    value={outlet.name}
                    disabled={!editable}
                    onChange={(event) => patchConfig(patchOutlet(stepKind, config, outlet.id, { name: event.target.value }))}
                  />
                </label>
                {/* A branch's two paths are the literal tags the executor writes, and
                    the condition that chooses between them is the step's own config —
                    so there is nothing per-path to ask for. */}
                {predicate !== 'none' && !outlet.fallback && (
                  <label>
                    <span>{predicate === 'match' ? t('flowStep.outletMatch') : t('flowStep.outletCondition')}</span>
                    <input
                      value={(predicate === 'match' ? outlet.match : outlet.condition) ?? ''}
                      placeholder={predicate === 'match' ? t('flowStep.outletMatchHint') : t('flowStep.outletConditionHint')}
                      disabled={!editable}
                      onChange={(event) => patchConfig(patchOutlet(stepKind, config, outlet.id, predicate === 'match' ? { match: event.target.value } : { condition: event.target.value }))}
                    />
                  </label>
                )}
                {editable && !outlet.fallback && predicate !== 'none' && <button
                  type="button"
                  aria-label={t('flowStep.removeOutlet', { name: outlet.name })}
                  onClick={() => patchConfig(removeOutlet(stepKind, config, outlet.id))}
                >×</button>}
              </div>
            ))}
          </div>
          {editable && predicate !== 'none' && <button
            type="button"
            className={styles.flowAdd}
            data-testid="flow-step-add-outlet"
            onClick={() => patchConfig(appendOutlet(stepKind, config))}
          >{t('flowStep.addOutlet')}</button>}
        </section>
      )}

      {/* 3. DATA IN. */}
      <section className={styles.flowSection}>
        <h4>{t('flowStep.dataIn')}</h4>
        <p>{t('flowStep.dataInHint')}</p>
        {rows('stepInputs', inputs, t('flowStep.bindingKey'), t('flowStep.bindingFrom'), t('flowStep.bindingFromHint'))}
      </section>

      {/* 4. DATA OUT — never offered on a step that decides: a capture placed after
          one would funnel every outlet through it and collapse the fan-out the author
          drew, so the compiler refuses to lower it and this refuses to promise it. */}
      {!decides && (
        <section className={styles.flowSection}>
          <h4>{t('flowStep.dataOut')}</h4>
          <p>{t('flowStep.dataOutHint')}</p>
          {rows('stepOutputs', outputs, t('flowStep.outputKey'), t('flowStep.outputFrom'), t('flowStep.outputFromHint'))}
        </section>
      )}

      {/* CONNECTIONS. */}
      <section className={styles.flowSection}>
        <h4>{t('flowStep.connections')}</h4>
        {incoming.length === 0 && outgoing.length === 0 && <p>{t('flowStep.noConnections')}</p>}
        <ul className={styles.flowConnections}>
          {incoming.map((edge) => (
            <li key={edge.id}>
              <i aria-hidden>←</i>
              <button type="button" onClick={() => onRevealObject?.(edge.source)}>{nameOf(edge.source)}</button>
              {onRemoveConnection && editable && <button
                type="button"
                aria-label={t('flowStep.removeConnection', { name: nameOf(edge.source) })}
                onClick={() => onRemoveConnection(edge.id)}
              >×</button>}
            </li>
          ))}
          {outgoing.map((edge) => {
            const outlet = outletForHandle(stepKind, config, edge.sourceHandle);
            return (
              <li key={edge.id}>
                <i aria-hidden>→</i>
                <button type="button" onClick={() => onRevealObject?.(edge.target)}>{nameOf(edge.target)}</button>
                {outlet?.name && <em>{outlet.name}</em>}
                {onRemoveConnection && editable && <button
                  type="button"
                  aria-label={t('flowStep.removeConnection', { name: nameOf(edge.target) })}
                  onClick={() => onRemoveConnection(edge.id)}
                >×</button>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
