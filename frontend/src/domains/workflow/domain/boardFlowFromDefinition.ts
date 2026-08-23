/**
 * A SAVED DEFINITION, UNPACKED ONTO THE BOARD — the other direction of
 * `compileBoardFlow`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Every workflow authored before the canvas became the workflow is a
 * `workflow_definitions` row with a `workflow` CARD standing in for it, and the
 * only way to edit one was the modal builder that is now gone. Deleting the modal
 * without this would strand them: a card you can run, cannot open, and cannot
 * change.
 *
 * So a legacy card is OPENED by being unpacked — each node becomes a `flowStep`
 * object at the position it already had, each edge becomes a board connection, and
 * a labeled edge is reattached to the OUTLET that label names, so a switch comes
 * back with its cases wired to the arms they were wired to. A frame is drawn round
 * the result, which is what makes it collapsible and openable as a section.
 *
 * Pure: it returns descriptors (`{ data, position }`), not React Flow nodes, so the
 * canvas keeps owning ids, selection and persistence. Lossless in the round trip
 * that matters — unpack, edit, recompile — because both directions read the same
 * outlet projection (`stepOutlets.ts`) rather than each parsing `routes`/`cases`.
 */

import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { NODE_KIND_MAP } from './stepCatalog';
import { createFlowStepData } from './flowStepObject';
import { stepOutlets } from './stepOutlets';
import { FRAME_DEFAULT_SIZE } from '@/domains/canvas/domain/canvasFrame';

/** The shape a saved definition arrives in. Structurally the API's `WorkflowDefinition`. */
export interface SavedDefinition {
  nodes: Array<{ id: string; kind: string; label: string; position?: { x: number; y: number } | null; config?: Record<string, unknown> | null }>;
  edges: Array<{ id: string; source: string; target: string; label?: string | null }>;
}

export interface UnpackedStep {
  /** The definition's own node id, so connections can be resolved before ids exist. */
  ref: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface UnpackedConnection {
  sourceRef: string;
  targetRef: string;
  /** The outlet the edge leaves from, or null for an unconditional connection. */
  sourceHandle: string | null;
  label: string | null;
}

export interface UnpackedFlow {
  steps: UnpackedStep[];
  connections: UnpackedConnection[];
  /** Where to draw the frame that holds the section, in board coordinates. */
  frame: { position: { x: number; y: number }; size: { width: number; height: number } };
}

const STEP_SIZE = { width: 260, height: 150 };
const FRAME_PADDING = 60;

/**
 * Unpack a definition into board objects, laid out at the origin the caller gives.
 *
 * `origin` is where the card being replaced sat, so the section appears where the
 * person was already looking rather than wherever the definition's coordinates
 * happened to be.
 */
export function boardFlowFromDefinition(definition: SavedDefinition, origin: { x: number; y: number }): UnpackedFlow {
  const positions = definition.nodes.map((node) => node.position ?? { x: 0, y: 0 });
  const left = positions.length ? Math.min(...positions.map((position) => position.x)) : 0;
  const top = positions.length ? Math.min(...positions.map((position) => position.y)) : 0;

  const steps: UnpackedStep[] = definition.nodes.map((node, index) => {
    const kind = (node.kind in NODE_KIND_MAP ? node.kind : 'agent') as WorkflowNodeKind;
    const position = node.position ?? { x: index * 300, y: 0 };
    return {
      ref: node.id,
      position: { x: origin.x + (position.x - left), y: origin.y + (position.y - top) },
      data: {
        ...createFlowStepData(kind, node.label || NODE_KIND_MAP[kind]?.label || kind),
        // The SAVED config wins over the catalog default: this is a definition that
        // has been running, not a fresh step.
        stepConfig: { ...(node.config ?? {}) },
      },
    };
  });

  const byRef = new Map(definition.nodes.map((node) => [node.id, node]));
  const connections: UnpackedConnection[] = definition.edges.map((edge) => {
    const source = byRef.get(edge.source);
    const label = typeof edge.label === 'string' && edge.label ? edge.label : null;
    // A labeled edge names an OUTLET. Resolving it back to that outlet's handle is
    // what makes an unpacked switch come back wired the way it was drawn — matched by
    // name because the name is all the edge carries, and positional ids are an
    // authoring-time convenience the definition format never stored.
    const outlet = source && label
      ? stepOutlets((source.kind in NODE_KIND_MAP ? source.kind : 'agent') as WorkflowNodeKind, source.config ?? {})
        .find((candidate) => candidate.name === label)
      : undefined;
    return {
      sourceRef: edge.source,
      targetRef: edge.target,
      sourceHandle: outlet?.id ?? null,
      label,
    };
  });

  const right = steps.length ? Math.max(...steps.map((step) => step.position.x + STEP_SIZE.width)) : origin.x + FRAME_DEFAULT_SIZE.width;
  const bottom = steps.length ? Math.max(...steps.map((step) => step.position.y + STEP_SIZE.height)) : origin.y + FRAME_DEFAULT_SIZE.height;
  return {
    steps,
    connections,
    frame: {
      position: { x: origin.x - FRAME_PADDING, y: origin.y - FRAME_PADDING },
      size: {
        width: right - origin.x + FRAME_PADDING * 2,
        height: bottom - origin.y + FRAME_PADDING * 2,
      },
    },
  };
}
