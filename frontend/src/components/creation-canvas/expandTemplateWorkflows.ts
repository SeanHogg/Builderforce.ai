/**
 * A TEMPLATE'S `workflow` OBJECTS, EXPANDED INTO SECTIONS BEFORE PLACEMENT.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `workflow` is a legacy kind: its only editor was the modal builder, which is
 * gone, so nothing may place one any more (see `creationObjectRegistry.ts`'s
 * `legacy` flag). Two marketplace templates (`campaign`, `social-growth-campaign`)
 * still declared `{ kind: 'workflow', data: { steps: [...] } }` entries — placing
 * either one would have minted exactly the object the deprecation removes.
 *
 * The fix is not to hand-rewrite each template's authored steps into positioned
 * `flowStep` objects: that is the same lowering `flowStepsFromCanvasSteps.ts`
 * already owns, duplicated a second time in template data. Instead, a `workflow`
 * entry is expanded through THAT module at load time, the same way opening a
 * legacy card on the board is — a frame plus one `flowStep` per authored step,
 * chained in the order they were written.
 *
 * ── WHY INDICES STAY STABLE ──────────────────────────────────────────────────
 * A template's `connections` name objects by their POSITION in `objects`. The
 * frame replacing a `workflow` entry keeps that entry's index, so any connection
 * that named the card by position now names the section it became — the
 * `campaign` pack's `workflow → website` edge becomes `frame → website` without
 * being rewritten. The steps inside the section have no index of their own in the
 * source data (they are drawn from one `workflow` entry, not authored as
 * objects), so they are appended after every original entry and wired with
 * connections generated here, in the same order `flowStepsFromCanvasSteps`
 * chains them.
 */

import { flowStepsFromCanvasSteps } from '@/domains/workflow/domain/flowStepsFromCanvasSteps';
import type { CreationTemplate } from './creationTemplates';

type TemplateObject = CreationTemplate['objects'][number];
type TemplateConnection = NonNullable<CreationTemplate['connections']>[number];

export interface ExpandTemplateWorkflowsOptions {
  /** Names a step that carries no title of its own — same localizer `unpackWorkflow` passes. */
  untitledStep: (position: number) => string;
  /** The frame's subtitle, in the caller's locale. */
  framePurpose: string;
}

/**
 * Replace every `workflow` entry with the section it stands for. A template
 * with no `workflow` entries is returned unchanged — most packs never had one.
 */
export function expandTemplateWorkflows(
  template: CreationTemplate,
  options: ExpandTemplateWorkflowsOptions,
): CreationTemplate {
  if (!template.objects.some((item) => item.kind === 'workflow')) return template;

  const appendedObjects: TemplateObject[] = [];
  const appendedConnections: TemplateConnection[] = [];
  // Appended objects land after every original entry, so their indices start
  // where the original array ends and grow as each workflow's steps are added.
  let cursor = template.objects.length;

  const objects: TemplateObject[] = template.objects.map((item) => {
    if (item.kind !== 'workflow') return item;
    const steps = Array.isArray(item.data?.steps) ? item.data.steps : [];
    const unpacked = flowStepsFromCanvasSteps(steps, { x: item.x, y: item.y }, { untitledStep: options.untitledStep });

    const stepIndexByRef = new Map<string, number>();
    for (const step of unpacked.steps) {
      stepIndexByRef.set(step.ref, cursor);
      appendedObjects.push({ kind: 'flowStep', x: step.position.x, y: step.position.y, data: step.data });
      cursor += 1;
    }
    for (const connection of unpacked.connections) {
      const source = stepIndexByRef.get(connection.sourceRef);
      const target = stepIndexByRef.get(connection.targetRef);
      if (source === undefined || target === undefined) continue;
      appendedConnections.push({ source, target, label: connection.label ?? '' });
    }

    return {
      kind: 'frame',
      title: item.title,
      x: unpacked.frame.position.x,
      y: unpacked.frame.position.y,
      size: unpacked.frame.size,
      data: {
        framePurpose: options.framePurpose,
        ...(typeof item.data?.approvalMode === 'string' ? { approvalMode: item.data.approvalMode } : {}),
        ...(typeof item.data?.runTarget === 'string' ? { runTarget: item.data.runTarget } : {}),
      },
    };
  });

  return {
    ...template,
    objects: [...objects, ...appendedObjects],
    connections: [...(template.connections ?? []), ...appendedConnections],
  };
}
