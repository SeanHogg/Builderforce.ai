/** The generic object and connection vocabulary — add, update, delete, arrange, convert, invoke, connect. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { COURSE_AUTHORING_CONTRACT, COURSE_AUTHORING_SCHEMA, GUIDED_TOUR_AUTHORING_SCHEMA, WEBSITE_PAGES_SCHEMA, WEBSITE_THEME_SCHEMA } from './authoringSchemas';
import { sheetFormulaGuidance } from '@/lib/canvasSheet';
import { FORMULA_FUNCTIONS } from '@/lib/canvasFormula';
import { approvalGuidance, type ApprovalMode, evaluateGate, readProvenance } from '@/lib/canvasApprovalGate';
import { CREATION_OBJECT_REGISTRY, creationObjectDefinition, emptyShellProblem, sanitizeCreationObjectPatch, TITLE_IS_CONTENT_KINDS } from '../creationObjectRegistry';
import type { CreationObjectKind } from '../types';
import { duplicateAddUpdateTarget } from '@/domains/canvas/domain/selection';
import { canvasObjectTwin } from '@/domains/canvas/domain/canvasBoard';
import { initializeResumeFromPatch, preserveResumeSourceForPatch } from '@/lib/canvasResume';
import { BRAND_BINDING_FIELD, canvasGameToolRedirect, canvasImageToolRedirect, canvasScreenshotToolRedirect, CREATION_CONNECTION_KINDS, type CreationConnectionKind, isBrandBoundKind, looksLikeWebPageUrl } from '@builderforce/creation-canvas-contract';
import { canvasSocialToolRedirect } from '@/lib/canvasSocial';
import { authoredWebsiteProblem } from '../websiteWysiwyg';
import { salvageUnrecognizedContent } from '../unrecognizedContentSalvage';
import { roomToolNote } from '@/lib/canvas/roomCreations';
import { roomAuthorshipProblem } from '@/lib/canvas/roomAuthorship';
import { arrangeCanvasNodes, type CanvasArrangement, canvasArrangementTargets } from '../creationCanvasLayout';
import { DIAGRAM_TARGETS } from '@/lib/diagramNotations';
import { specBoardOf } from '../canvasNodeHelpers';
import { BRAND_BINDING_HINT } from '@/lib/marketingObjects';
import { ACCOUNT_REQUIRED_OBJECT_ACTIONS, accountGateResult, DEDICATED_ACTION_TOOLS } from './accountGate';
import { canInvokeCreationObjectAction } from '@/domains/canvas/domain/canvasChange';
import { erasureRefusal } from '@/lib/canvasConfidentiality';
import type { Edge } from '@xyflow/react';
import type { CanvasActionContext } from './context';

export function canvasObjectActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, convertObjectToDiagram, layoutViewportRef, localizedTourDefaults, measurementGate, persistence, promptRef, requireAccount, stage, t } = ctx;
  return [  {
    name: 'canvas_add_object',
    description: `Create a fully authored visual object. For an actual image, NEVER use this tool; use canvas_add_image so pixels are found or generated and attached immediately. Put type-specific content in fields; supported fields depend on kind and are listed in the current canvas snapshot. Never send placeholder or schema-probe fields. For kind="course", author the curriculum in the FIRST call as fields.course = ${COURSE_AUTHORING_CONTRACT}. Never author rows or chart values by hand from an imported dataset — use canvas_query_dataset so the artifact holds real computed values. For kind="spreadsheet", a derived column is a FORMULA and never a column of typed numbers: ${sheetFormulaGuidance(FORMULA_FUNCTIONS)} ${approvalGuidance()}`,
    parameters: {
      type: 'object', required: ['kind'], additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: CREATION_OBJECT_REGISTRY.map((definition) => definition.kind) },
        title: { type: 'string' }, subtitle: { type: 'string' }, status: { type: 'string' },
        allowDuplicateTitle: { type: 'boolean', description: 'Only when the user genuinely wants a SECOND object of this kind with the same name. Never set this to recover from a rejected duplicate — update the existing object instead.' },
        fields: { type: 'object', description: 'Type-specific authored content. Unknown or sensitive fields are rejected. Website and prototype objects require complete WYSIWYG pages and an authored theme; never create a titled shell. For courses, course must match the declared nested schema. For guidedTour objects, author the complete reusable onboarding contract in tour.', properties: { course: COURSE_AUTHORING_SCHEMA, tour: GUIDED_TOUR_AUTHORING_SCHEMA, pages: WEBSITE_PAGES_SCHEMA, websiteTheme: WEBSITE_THEME_SCHEMA }, additionalProperties: true },
        x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { kind?: CreationObjectKind; title?: string; subtitle?: string; status?: string; fields?: unknown; x?: number; y?: number; width?: number; height?: number; allowDuplicateTitle?: boolean };
      const allowed = new Set(CREATION_OBJECT_REGISTRY.map((definition) => definition.kind));
      if (!args.kind || !allowed.has(args.kind)) return { error: 'Unsupported canvas object kind' };
      const unmeasured = measurementGate(args.kind);
      if (unmeasured) return unmeasured;
      const updateTarget = duplicateAddUpdateTarget(promptRef.current, args.kind, ctx.nodes(), ctx.effectiveSelectedIds());
      if (updateTarget) return { error: `This is a correction to selected ${args.kind} ${updateTarget.id}. Call canvas_update_object for that object instead of creating a duplicate.` };
      // THE BOARD REMEMBERS WHAT THE MODEL NO LONGER CAN. A turn whose completion
      // was cut off at the length limit re-authors objects it already made — the
      // failure that put `CMO` on one real board three times — and the guard above
      // cannot catch it, because a re-authored object is not the SELECTED one.
      // Reads `stage.nodes()`, so a duplicate proposed earlier in this same turn is
      // caught as well as one already committed to the board.
      const twin = args.allowDuplicateTitle === true
        ? undefined
        : canvasObjectTwin(args.kind, args.title, stage.nodes(), (kind) => TITLE_IS_CONTENT_KINDS.has(kind));
      if (twin) return { error: `This board already holds ${args.kind} "${twin.data.title}" (${twin.id}). Call canvas_update_object on that object to add or correct its content. Only pass allowDuplicateTitle if the user genuinely wants a second, separate object with the same name.` };
      const node = stage.createObject(args.kind, args);
      if (args.kind === 'guidedTour') node.data = { ...node.data, ...localizedTourDefaults() };
      let authored = sanitizeCreationObjectPatch(args.kind, { ...((args.fields && typeof args.fields === 'object') ? args.fields : {}), title: args.title, subtitle: args.subtitle, status: args.status });
      if (args.kind === 'resume') authored = initializeResumeFromPatch(typeof authored.title === 'string' ? authored.title : node.data.title, authored);
      // A REQUEST FOR PIXELS ROUTED HERE IS A MISROUTE, NOT A MALFORMED CALL.
      //
      // "draw me a coniferous landscape at <address>" arrives as kind "drawing" with no
      // points, or kind "image" with no pixels — both because those are the kinds whose
      // NAMES match the request. The old refusal described the drawing schema and
      // offered a chart instead; the model relayed it as "a technical limitation with
      // the drawing tool" and told the user the product cannot draw (2026-08-12, ui
      // 2026.7.213). Name the tool that would actually work. On an anonymous board it
      // is advertised and self-gating, so this redirect is correct on both surfaces.
      const wantsPixels = args.kind === 'image' && !authored.outputUrl;
      const emptyDrawing = args.kind === 'drawing' && (!Array.isArray(authored.points) || authored.points.length < 2);
      if (wantsPixels || emptyDrawing) return { error: canvasImageToolRedirect(args.kind) };
      // A URL that is a PAGE, not a picture: the model was asked to show a live site
      // and reached for the image object. The screenshot tool is what photographs it.
      if (args.kind === 'image' && typeof authored.outputUrl === 'string' && looksLikeWebPageUrl(authored.outputUrl)) return { error: canvasScreenshotToolRedirect() };
      // THE SAME MISROUTE, ONE KIND OVER, AND THE MOST EXPENSIVE ONE. A `game`
      // authored here is a brief with no artifact: generating the playable thing
      // is a separate step the model does not know to take. It reached the board
      // holding a four-thousand-word design document in `content` — which
      // satisfied the empty-shell gate (that gate NAMES `content` first, so it
      // actively teaches this mistake) and played nothing. Name the tool that
      // actually produces a game. See `canvasGameToolRedirect`.
      if (args.kind === 'game' && !authored.outputUrl) return { error: canvasGameToolRedirect() };
      // THE SAME MISROUTE, ONE DOMAIN OVER. A social feed, a pinned post and a campaign
      // are READ from connected accounts and from the server's publish ledger, so this
      // tool can only ever produce a convincing fake of one. Name the tool that reads
      // the real thing — see `canvasSocialToolRedirect` for the refusal this replaces,
      // which asked a model to hand-author a campaign id and a published count.
      const socialRedirect = canvasSocialToolRedirect(args.kind);
      if (socialRedirect) return { error: socialRedirect };
      // A Course seeds the worked "Build an LLM" sample so a human dragging one
      // out of the palette gets something real to read. That default is a TRAP
      // for a generated object: a course titled "Recruiting and Hiring" with no
      // authored `course` inherits the LLM curriculum verbatim, which reads as
      // the product having built the wrong subject rather than as a missing
      // argument. Refuse it and say what to send instead.
      if (args.kind === 'course' && !(authored.course as { modules?: unknown } | undefined)?.modules) {
        return { error: `A generated course must include the authored curriculum in fields.course as ${COURSE_AUTHORING_CONTRACT}. Without it the object would show the sample "Build an LLM" curriculum under your title.` };
      }
      if (args.kind === 'website' || args.kind === 'prototype') {
        const problem = authoredWebsiteProblem(authored);
        if (problem) return { error: `${problem} Do not create an empty website shell or rely on renderer defaults.` };
      }
      // The general form of the three rules above: an artifact whose only authored
      // field is its title is not a deliverable. Registry-driven, so every kind is
      // covered rather than the three that happened to get a bespoke branch.
      // Before refusing, keep work the model DID write under names this kind does not
      // declare as the card's content. Only a card that is truly title-only is refused.
      let foldedFields: readonly string[] = [];
      if (emptyShellProblem(args.kind, authored as Record<string, unknown>)) {
        const salvage = salvageUnrecognizedContent(args.kind, args.fields, authored as Record<string, unknown>);
        authored = salvage.authored as typeof authored;
        foldedFields = salvage.folded;
      }
      const shellProblem = emptyShellProblem(args.kind, authored as Record<string, unknown>);
      if (shellProblem) return { error: shellProblem };
      node.data = { ...node.data, ...authored, title: typeof authored.title === 'string' && authored.title.trim() ? authored.title.slice(0, 160) : node.data.title };
      const width = Number(args.width); const height = Number(args.height);
      if (Number.isFinite(width) || Number.isFinite(height)) node.style = { width: Number.isFinite(width) ? Math.max(240, Math.min(width, 2_400)) : undefined, height: Number.isFinite(height) ? Math.max(130, Math.min(height, 1_800)) : undefined };
      stage.addObject(`Add ${node.data.kind} “${node.data.title}”`, node);
      return { ok: true, proposed: true, object: { id: node.id, kind: node.data.kind, title: node.data.title }, mutableFields: creationObjectDefinition(args.kind).mutableFields, ...(foldedFields.length ? { note: `${args.kind} does not declare ${foldedFields.join(', ')}; that content was kept in content. Use the mutableFields names when updating this object.` } : {}), ...(roomToolNote(args.kind) ? { instruction: roomToolNote(args.kind) } : {}) };
    },
  },   {
    name: 'canvas_update_object',
    description: 'Author or revise any supported field of an existing canvas object. Read the snapshot first to learn its kind and mutableFields. For a resume, send the complete JSON Resume object in fields.resumeDocument when possible; the Canvas creates a derived revision and protects the uploaded original automatically.',
    parameters: { type: 'object', required: ['objectId', 'fields'], additionalProperties: false, properties: { objectId: { type: 'string' }, fields: { type: 'object', additionalProperties: true } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; fields?: unknown };
      const target = stage.object(args.objectId);
      if (!args.objectId || !target) return { error: 'Object not found' };
      // The same gate the add path applies, for the same reason: filling a `job` card's
      // match score in a second call is the identical unmeasured claim as creating it
      // with one, and a gate on only one of the two doors is a gate on neither.
      const unmeasuredUpdate = measurementGate(target.data.kind);
      if (unmeasuredUpdate) return unmeasuredUpdate;
      let patch = sanitizeCreationObjectPatch(target.data.kind, args.fields);
      if (!Object.keys(patch).length) return { error: `No supported fields supplied. Mutable fields: ${creationObjectDefinition(target.data.kind).mutableFields.join(', ')}` };
      if (target.data.kind === 'resume') {
        const protectedPatch = preserveResumeSourceForPatch(target.data, patch);
        patch = { ...protectedPatch, ...(protectedPatch.resumeFamily ? { status: t('resumeEditor.statusDerived') } : {}) };
      }
      if (target.data.kind === 'website' || target.data.kind === 'prototype') {
        const problem = authoredWebsiteProblem({ ...target.data, ...patch });
        if (problem) return { error: `${problem} Update this object with its complete WYSIWYG page structure.` };
      }
      if (target.data.kind === 'room') {
        const roomProblem = roomAuthorshipProblem({ ...target.data, ...patch } as Record<string, unknown>);
        if (roomProblem) return { error: roomProblem };
      }
      stage.updateObject(`Update ${args.objectId}`, args.objectId, patch);
      return { ok: true, proposed: true, objectId: args.objectId, updatedFields: Object.keys(patch) };
    },
  },   {
    name: 'canvas_delete_object',
    description: 'Remove an object and all of its connections from the canvas.',
    parameters: { type: 'object', required: ['objectId'], additionalProperties: false, properties: { objectId: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const objectId = (raw as { objectId?: string }).objectId;
      const target = stage.object(objectId);
      if (!objectId || !target) return { error: 'Object not found' };
      stage.deleteObject(`Delete ${target.data.title}`, objectId);
      return { ok: true, proposed: true, objectId };
    },
  },   {
    name: 'canvas_arrange_objects',
    description: 'Automatically position multiple canvas objects in a non-overlapping grid, row, or column using their actual rendered sizes. Use this for requests to organize, align, evenly space, tidy, or remove overlaps. When objectIds is omitted, this intentionally arranges the whole visible canvas regardless of the prompt selection scope.',
    parameters: { type: 'object', additionalProperties: false, properties: { objectIds: { type: 'array', items: { type: 'string' }, description: 'Specific objects to arrange. Omit to arrange every visible unlocked object on the canvas, even when the composer is scoped to a single selection.' }, arrangement: { type: 'string', enum: ['grid', 'row', 'column'] }, gap: { type: 'number', description: 'Space between object bounds in canvas pixels.' }, columns: { type: 'number', description: 'Optional grid column count.' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectIds?: unknown; arrangement?: CanvasArrangement; gap?: number; columns?: number };
      const requestedIds = Array.isArray(args.objectIds) ? new Set(args.objectIds.filter((id): id is string => typeof id === 'string')) : null;
      const targets = canvasArrangementTargets(stage.nodes(), requestedIds);
      if (targets.length < 2) return { error: 'At least two unlocked objects are required to arrange the canvas' };
      const viewport = layoutViewportRef.current();
      const arrangement = args.arrangement ?? (viewport.narrow ? 'column' : undefined);
      const positions = arrangeCanvasNodes(targets, arrangement, Number(args.gap ?? 48), Number(args.columns), viewport.width);
      let proposed = 0;
      for (const target of targets) {
        const position = positions.get(target.id);
        if (!position || (position.x === target.position.x && position.y === target.position.y)) continue;
        stage.layoutObject(`Arrange ${target.data.title}`, target.id, { position });
        proposed += 1;
      }
      return { ok: true, proposed: true, arrangedObjects: targets.length, proposedChanges: proposed, arrangement: arrangement || 'grid', gap: Math.max(16, Math.min(Number(args.gap ?? 48), 320)) };
    },
  },   {
    name: 'canvas_set_object_layout',
    description: 'Move, resize, hide, show, lock, or unlock an existing canvas object.',
    parameters: { type: 'object', required: ['objectId'], additionalProperties: false, properties: { objectId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, hidden: { type: 'boolean' }, locked: { type: 'boolean' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; x?: number; y?: number; width?: number; height?: number; hidden?: boolean; locked?: boolean };
      const current = stage.object(args.objectId);
      if (!args.objectId || !current) return { error: 'Object not found' };
      const hasPosition = Number.isFinite(args.x) || Number.isFinite(args.y);
      const position = hasPosition ? { x: Number.isFinite(args.x) ? Number(args.x) : current.position.x, y: Number.isFinite(args.y) ? Number(args.y) : current.position.y } : undefined;
      const layout = { ...(position ? { position } : {}), ...(Number.isFinite(args.width) ? { width: Math.max(240, Math.min(Number(args.width), 2_400)) } : {}), ...(Number.isFinite(args.height) ? { height: Math.max(130, Math.min(Number(args.height), 1_800)) } : {}), ...(typeof args.hidden === 'boolean' ? { hidden: args.hidden } : {}), ...(typeof args.locked === 'boolean' ? { locked: args.locked } : {}) };
      if (!Object.keys(layout).length) return { error: 'No layout change supplied' };
      stage.layoutObject(`Arrange ${current.data.title}`, args.objectId, layout);
      return { ok: true, proposed: true, objectId: args.objectId };
    },
  },   {
    name: 'canvas_convert_diagram',
    // The enum is built from the notation registry, so the model is told exactly
    // the destinations that exist. A hand-written list here is how a prompt ends
    // up naming a format the canvas cannot write.
    description: `Convert a Diagram, vector Image, CAD drawing, uploaded Image or freehand Drawing into a diagram in another notation. Destinations: ${DIAGRAM_TARGETS.map((notation) => `${notation.id} (${notation.name})`).join(', ')}. A picture with no shapes in it can only become drawio, where it is embedded; to add another picture to the same draw.io file, pass that existing Diagram as diagramObjectId.`,
    parameters: { type: 'object', required: ['sourceObjectId'], additionalProperties: false, properties: {
      sourceObjectId: { type: 'string', description: 'Diagram, Image, CAD or Drawing object to convert.' },
      format: { type: 'string', enum: DIAGRAM_TARGETS.map((notation) => notation.id), description: 'Destination notation. Omit for the first one this source supports.' },
      diagramObjectId: { type: 'string', description: 'Existing draw.io Diagram to append a picture to. Omit to create a new file; when exactly one draw.io Diagram exists it is reused.' },
    } },
    mutates: true,
    run: async (raw: unknown) => {
      const args = raw as { sourceObjectId?: string; format?: string; diagramObjectId?: string };
      if (!args.sourceObjectId) return { error: 'sourceObjectId is required' };
      const result = await convertObjectToDiagram(args.sourceObjectId, args.format, args.diagramObjectId);
      return result.ok ? { ok: true, diagramObjectId: result.diagramId, savedWithSession: persistence === 'server' } : { error: result.error };
    },
  },   {
    name: 'canvas_invoke_object_action',
    description: 'Invoke a native capability declared by a canvas object. Inspect and edit return guidance immediately; operational actions are proposed for user review before execution.',
    parameters: { type: 'object', required: ['objectId', 'action'], additionalProperties: false, properties: { objectId: { type: 'string' }, action: { type: 'string' } } },
    mutates: (raw: unknown) => !['inspect', 'edit'].includes(String((raw as { action?: unknown })?.action || '')),
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; action?: string };
      const target = stage.object(args.objectId);
      if (!args.objectId || !target) return { error: 'Object not found' };
      const definition = creationObjectDefinition(target.data.kind);
      if (!args.action || !definition.actions.includes(args.action)) return { error: `Unsupported action. Available actions: ${definition.actions.join(', ')}` };
      if (args.action === 'inspect') {
        return {
          object: { id: target.id, ...definition.contextAdapter(target.data, specBoardOf(ctx.nodes())) },
          actions: definition.actions,
          mutableFields: definition.mutableFields,
          // The binding field is a bare name on the registry; the hint that says how
          // it resolves has to reach the model somewhere, and inspect is where it
          // reads a kind's fields.
          ...(isBrandBoundKind(target.data.kind) ? { fieldHints: { [BRAND_BINDING_FIELD]: BRAND_BINDING_HINT } } : {}),
        };
      }
      if (args.action === 'edit') return { objectId: target.id, kind: target.data.kind, mutableFields: definition.mutableFields, instruction: 'Call canvas_update_object with the desired fields.' };
      // The redirect FIRST: an act with a dedicated tool is not an unimplemented act,
      // and answering "no delivery adapter" for one is how a model comes to tell a
      // user the product cannot do something it can.
      const dedicated = DEDICATED_ACTION_TOOLS[target.data.kind]?.[args.action];
      if (dedicated) {
        return {
          error: `${args.action} on a ${definition.label} is performed by ${dedicated}, which takes the details this action cannot carry. Call ${dedicated} instead — do not claim this ran.`,
          useTool: dedicated, objectId: target.id, action: args.action,
        };
      }
      if (!canInvokeCreationObjectAction(target.data.kind, args.action)) {
        return { error: `${args.action} is declared for ${definition.label}, but no real Canvas delivery adapter is connected yet. Do not claim that it ran.` };
      }
      if (persistence === 'local' && ACCOUNT_REQUIRED_OBJECT_ACTIONS.has(args.action)) {
        requireAccount(args.action, `Create an account to ${args.action}`, `Your ${target.data.title} remains saved on this device. Create a free account to ${args.action} it with durable tenant resources, permissions, and history.`);
        return {
          ...accountGateResult('canvas_invoke_object_action', `"${args.action}" needs a free Builderforce account: it creates or changes a durable tenant resource, which an anonymous canvas has none of. The account prompt is now open and the canvas is unchanged. Say that in one sentence and keep building what this canvas can hold; never claim the action ran.`),
          action: args.action, objectId: target.id,
        };
      }
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      // ── The retention gate ───────────────────────────────────────────────────
      //
      // An `erase` is a data-subject request, and a hiring or employment record has a
      // legal floor under it. Decided here, at the one seam every model-invoked act
      // passes through, from the same rule table the boundary paths read.
      if (args.action === 'erase') {
        const refusal = erasureRefusal(target.data.kind, target.data as Record<string, unknown>);
        if (refusal) return { error: refusal, objectId: target.id, action: args.action };
      }
      // ── The approval gate ────────────────────────────────────────────────────
      //
      // Two reviews found the same hole from opposite sides: outbound acts (send,
      // publish, share) were direct-fire with no reviewer, and attested acts (approve a
      // budget, authorise a bill, issue an invoice) had no record of who stood behind
      // the figure. Both are "an act that needs authority before it takes effect", so
      // both go through ONE gate rather than two — see `canvasApprovalGate.ts`.
      //
      // Evaluated HERE, at the single seam every model-invoked action passes through,
      // rather than per kind: a gate a caller can forget to consult is not a gate.
      const gate = evaluateGate({
        kind: target.data.kind,
        action: args.action,
        ...(typeof target.data.approvalMode === 'string' ? { mode: target.data.approvalMode as ApprovalMode } : {}),
        // The model is acting, so it is the actor. It is deliberately NOT allowed to
        // satisfy its own `required` gate — an approval an agent granted to an agent is
        // not review, it is a second copy of the same judgement.
        actor: { kind: 'brain', ref: 'brain', name: 'Brain' },
        provenance: readProvenance(target.data as Record<string, unknown>),
      });
      if (!gate.allowed) return { error: gate.message, objectId: target.id, action: args.action, awaitingApproval: true };
      stage.invokeAction(`${args.action} ${target.data.title}`, target.id, args.action);
      return { ok: true, proposed: true, objectId: target.id, action: args.action, approval: gate.reason };
    },
  },   {
    name: 'canvas_connect_objects',
    description: 'Draw a labeled relationship between two existing canvas objects.',
    parameters: { type: 'object', required: ['sourceId', 'targetId'], additionalProperties: false, properties: { sourceId: { type: 'string' }, targetId: { type: 'string' }, kind: { type: 'string', enum: [...CREATION_CONNECTION_KINDS] }, label: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { sourceId?: string; targetId?: string; kind?: CreationConnectionKind; label?: string };
      const exists = (id: string) => stage.hasObject(id);
      if (!args.sourceId || !args.targetId || !exists(args.sourceId) || !exists(args.targetId)) return { error: 'Source or target object not found' };
      const edge = { id: crypto.randomUUID(), source: args.sourceId, target: args.targetId, label: args.label?.slice(0, 120), type: 'smoothstep', animated: true, data: { connectionKind: args.kind || 'reference' } } satisfies Edge;
      stage.addConnection(`Connect objects${args.label ? `: ${args.label}` : ''}`, edge);
      return { ok: true, proposed: true, connectionId: edge.id };
    },
  },   {
    name: 'canvas_update_connection',
    description: 'Change the label or semantic kind of an existing connection.',
    parameters: { type: 'object', required: ['connectionId'], additionalProperties: false, properties: { connectionId: { type: 'string' }, kind: { type: 'string', enum: [...CREATION_CONNECTION_KINDS] }, label: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { connectionId?: string; kind?: CreationConnectionKind; label?: string };
      const exists = stage.hasConnection(args.connectionId);
      if (!args.connectionId || !exists) return { error: 'Connection not found' };
      const patch = { ...(typeof args.label === 'string' ? { label: args.label.slice(0, 120) } : {}), ...(args.kind && CREATION_CONNECTION_KINDS.includes(args.kind) ? { kind: args.kind } : {}) };
      if (!Object.keys(patch).length) return { error: 'No connection change supplied' };
      stage.updateConnection(`Update connection ${args.connectionId}`, args.connectionId, patch);
      return { ok: true, proposed: true, connectionId: args.connectionId };
    },
  },   {
    name: 'canvas_delete_connection',
    description: 'Remove an existing relationship between canvas objects.',
    parameters: { type: 'object', required: ['connectionId'], additionalProperties: false, properties: { connectionId: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const connectionId = (raw as { connectionId?: string }).connectionId;
      const exists = stage.hasConnection(connectionId);
      if (!connectionId || !exists) return { error: 'Connection not found' };
      stage.deleteConnection(`Delete connection ${connectionId}`, connectionId);
      return { ok: true, proposed: true, connectionId };
    },
    // ADVERTISE ONLY WHAT THIS SESSION CAN EXECUTE. An anonymous canvas has no tenant,
    // so every tool that reads or writes a tenant resource (a connected mailbox,
    // canonical PRDs, tenant domain data, server-side image generation) is removed
    // here — the gateway strips them from the request anyway
    // (`api/application/guest/guestCanvasTools`). Advertising them regardless is what
    // made "connect my email" fail silently: the model planned around
    // `canvas_add_inbox`, the gateway deleted it before dispatch, and the turn ended
    // with prose and zero tool calls. Both sides read ONE contract.
  }];
}
