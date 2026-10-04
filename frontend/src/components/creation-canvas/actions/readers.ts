/** Reading the board and what is attached to it — snapshot, object, document, attachment, project PRDs (and authoring the canonical PRD). */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { canvasDocument } from '@/lib/canvasDocuments';
import { readAttachmentSource } from '@/lib/canvasAttachmentUploadApi';
import { aiContextGate, boardInventory, findInInventory, scopeNote } from '@/lib/canvasContextSnapshot';
import { creationObjectDefinition } from '../creationObjectRegistry';
import { canvasNodeDimensions } from '../creationCanvasLayout';
import { newNode, specBoardOf } from '../canvasNodeHelpers';
import { objectMayCross } from '@/lib/canvasConfidentiality';
import { canvasProjectId, canvasProjectNodes } from '@/lib/canvasProjectRef';
import { creationSessionsApi } from '@/lib/builderforceApi';
import type { CanvasActionContext } from './context';

export function canvasReaderActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, openAccountGate, persistence, sessionId, stage, t } = ctx;
  return [  {
    /**
     * READ A SCAN INTO THE BOARD.
     *
     * The general case of `canvas_import_resume`'s escalation, which had exactly one
     * destination: a résumé. Everything else a person drops that the browser cannot read —
     * a scanned contract, a photographed invoice, an encrypted PDF, a page of a lecture
     * handout — stayed an attachment card saying its text could not be extracted, with its
     * bytes sitting in R2 behind a door nothing opened.
     *
     * The bytes have been retained since `uploadAttachmentSource` shipped. This is the
     * read. It produces a `document`, which is what the canvas already uses for markdown
     * a person edits, exports and asks questions of.
     */
    name: 'canvas_read_attachment',
    description: 'Read a dropped file the browser could not extract text from — a SCANNED or photographed page, or an encrypted PDF — and put it on the canvas as an editable document. Use this when an attachment card says its text could not be extracted, or when someone asks you to read, transcribe or open a scan. It transcribes the page as it is, so the document that lands is the source, not a summary. It costs a model call and needs a signed-in, saved session. Do NOT use it on a file whose text the canvas already holds.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The attachment object to read. Omit when exactly one unreadable attachment is on the canvas.' },
        title: { type: 'string', description: 'Title for the resulting document. Defaults to the file name.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; title?: string };
      const all = stage.nodes();
      // An attachment whose bytes were retained and whose text was never extracted. Both
      // halves matter: a file with a `canvasDocument` was already read for free in the
      // browser, and re-reading it through a model would spend tokens to produce a worse
      // copy of something the board already holds.
      const readable = all.filter((node) => node.data.kind === 'file'
        && !canvasDocument(node.data)
        && (typeof node.data.sourceFileKey === 'string' || typeof node.data.sourceDataUrl === 'string'));
      const source = args.objectId ? all.find((node) => node.id === args.objectId) : readable.length === 1 ? readable[0] : undefined;
      if (!source) {
        return { error: readable.length
          ? `Specify which attachment to read. Unread attachments on this canvas: ${readable.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'Nothing on this canvas is an unread attachment. A file whose text the board already holds does not need this — read it directly.' };
      }
      if (canvasDocument(source.data)) {
        return { error: `Object ${source.id} already carries readable text — read it directly rather than re-reading the file.` };
      }

      const sourceFileKey = typeof source.data.sourceFileKey === 'string' ? source.data.sourceFileKey : undefined;
      const sourceDataUrl = typeof source.data.sourceDataUrl === 'string' ? source.data.sourceDataUrl : undefined;
      if (!sourceFileKey && !sourceDataUrl) {
        return { error: `Object ${source.id} kept no bytes, so there is nothing left to read. Ask for the file again.` };
      }
      if (persistence !== 'server') {
        // Through `openAccountGate` rather than a bare `error`, which is what makes it a
        // GATE rather than a dead end: the shape carries `requiresAccount`, the canvas
        // opens the account prompt as the model reads this, and the turn ends with a
        // one-click reason instead of a sentence the model may relay as a limitation of
        // the product. Same contract as `canvas_add_image` — see GUEST_GATED_CANVAS_TOOLS.
        // It called `accountGateResult` directly until 2026-08-19, which returned the
        // shape WITHOUT raising the prompt the reason promises — so the model said "the
        // account prompt is now open" to a visitor looking at an unchanged screen.
        return openAccountGate('canvas_read_attachment', 'attachment', t('gateAttachmentTitle'), t('gateAttachmentBody'), 'Reading a scan takes a model call billed to a workspace, which needs a free Builderforce account and a saved canvas. The account prompt is now open and the canvas is unchanged. Say that in one sentence — never claim the product cannot read scanned documents.');
      }

      const fileName = typeof source.data.fileName === 'string' ? source.data.fileName : String(source.data.title || 'attachment');
      let read: Awaited<ReturnType<typeof readAttachmentSource>>;
      try {
        read = await readAttachmentSource({ fileName, ...(sourceFileKey ? { sourceFileKey } : {}), ...(sourceDataUrl ? { dataUrl: sourceDataUrl } : {}) });
      } catch (error) {
        return { error: `Reading the file failed: ${error instanceof Error ? error.message : String(error)}` };
      }

      const node = stage.createObject('document', { x: source.position.x + 460, y: source.position.y });
      node.data = {
        ...node.data,
        title: String(args.title ?? '').trim() || fileName.replace(/\.[^.]+$/, '') || String(source.data.title || 'Document'),
        markdown: read.markdown,
        content: read.markdown,
        // The provenance travels with the document: a transcription is a READING of a
        // source, and a reader who cannot get back to the page it came from cannot check
        // it. `[illegible]` markers are only honest if the original is still reachable.
        sources: [{ title: fileName, url: '' }],
        status: 'Transcribed',
      };
      node.style = { width: 560, height: 620 };
      stage.addObject(`Read ${fileName}`, node);

      const illegible = (read.markdown.match(/\[illegible\]/gi) ?? []).length;
      return {
        ok: true, proposed: true,
        objectId: node.id,
        readFrom: source.id,
        characters: read.markdown.length,
        illegible,
        model: read.model,
        instruction: illegible
          ? `The page is on the board as a document, with ${illegible} passage(s) the model could not make out, marked [illegible]. Say so — the person may have a better copy. Do NOT guess at what they said.`
          : 'The page is on the board as an editable document. Say what it appears to be in one line and offer the next step. Do NOT retype its contents.',
      };
    },
  },   {
    name: 'canvas_read_snapshot',
    // This tool PROMISED "every object" and delivered the scoped subset, which is
    // how the one escape hatch from a partial view became a second confirmation
    // of it: the model checked, was told the board held one object, and reported
    // a file missing that was sitting right there. Asking to read everything is
    // an explicit request to leave the scope, so it now does.
    description: 'Read every object and relationship on the creation canvas — the WHOLE board, regardless of what the user has selected. Use this whenever you are about to say something is not on the canvas.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      // LIVE, and including this turn's staged proposals. The memo captured `nodes` when
      // the turn began, so a second loop inside the same turn — the Brain synthesis that
      // follows an invited agent's contribution — was told the board held 24 objects
      // while the first loop's build sat on it as the 25th, and duly created a second
      // one (session bf886fc1). `stage.nodes()` is what every authoring tool already
      // reads for "what is here", so this reads the same thing.
      const board = stage.nodes();
      // "Every object" means every object the reader is CLEARED for. The withheld ones
      // still reach the model as inventory rows, so the promise this tool exists to keep
      // — never claim something is absent — survives the gate.
      const gate = aiContextGate(board);
      return {
      scope: ctx.resolvedScopeMode(),
      scopeNote: scopeNote('canvas', board.length, board.length),
      ...(gate.note ? { confidentialityNote: gate.note } : {}),
      boardInventory: boardInventory(board, ctx.scopedNodeIds()),
      objects: ((spec) => gate.visible.map((node) => { const definition = creationObjectDefinition(node.data.kind); const dimensions = canvasNodeDimensions(node); return { id: node.id, ...definition.contextAdapter(node.data, spec), mutableFields: definition.mutableFields, actions: definition.actions, position: node.position, ...dimensions, hidden: node.hidden === true, locked: node.data.placementLocked === true, inScope: ctx.scopedNodeIds().has(node.id) }; }))(specBoardOf(board)),
      connections: stage.edges().map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
      };
    },
  },   {
    // The lookup the scope note points at. Named rather than positional because
    // the reported failure was a NAME miss (`.htm` vs `.html`), and a model that
    // has to guess an object id to check whether an object exists will not check.
    name: 'canvas_read_object',
    description: 'Read one object on this canvas in full by id, title, or file name — including objects outside the current selection. Use this before telling the user that a file or object is not on the canvas: matching tolerates a wrong extension and a partial name.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'Exact object id from boardInventory.' },
        name: { type: 'string', description: 'Title or file name the user referred to, e.g. "Sales-Discovery-Guide.htm".' },
      },
    },
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; name?: string };
      // Live board plus this turn's staged additions — same reasoning as
      // canvas_read_snapshot above: an object another loop of this turn just added
      // must be findable, or the model re-creates it.
      const board = stage.nodes();
      const inventory = boardInventory(board, ctx.scopedNodeIds());
      const match = args.objectId
        ? inventory.find((entry) => entry.id === args.objectId) ?? null
        : findInInventory(inventory, args.name ?? '');
      if (!match) {
        // An honest miss carries the inventory, so the next sentence the model
        // writes is grounded in what IS there rather than in what it expected.
        return { found: false, boardInventory: inventory, message: 'No object on this board matches that id or name. The full inventory is included — do not ask the user to upload something listed in it.' };
      }
      const node = board.find((candidate) => candidate.id === match.id);
      if (!node) return { found: false, boardInventory: inventory };
      // The object is HERE and you may not read it. Saying so plainly is the whole
      // point: a refusal that looked like a miss would send the model back to
      // "upload it again", which is the failure this tool was built to end.
      if (!objectMayCross(node, 'aiContext')) {
        return {
          found: true, restricted: true, object: { id: node.id, kind: node.data.kind, title: node.data.title || '(untitled)' },
          message: 'This object is on the canvas and is marked restricted, so its contents are withheld from you. Do NOT say it is missing and do NOT ask the user to upload it. Tell them it is marked restricted and that they can change its confidentiality on the card if they want it discussed.',
        };
      }
      const definition = creationObjectDefinition(node.data.kind);
      return {
        found: true,
        object: { id: node.id, ...definition.contextAdapter(node.data, specBoardOf(board)), mutableFields: definition.mutableFields, actions: definition.actions },
        connections: stage.edges()
          .filter((edge) => edge.source === node.id || edge.target === node.id)
          .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
      };
    },
  },   {
    name: 'canvas_read_project_prds',
    description: 'Read the complete canonical PRDs and version history for every ticket in a project. Always use this before synthesizing, consolidating, or explaining project requirements; canvas selection does not limit this project-wide read.',
    parameters: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'number', description: 'Canonical project id. Omit when exactly one project is present on the canvas.' } } },
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Canonical project PRDs require a saved session' };
      const requested = Number((raw as { projectId?: unknown })?.projectId);
      const available = canvasProjectNodes(ctx.nodes()).map((node) => canvasProjectId(node.data)!);
      const projectId = Number.isInteger(requested) && requested > 0 ? requested : available.length === 1 ? available[0]! : NaN;
      if (!Number.isInteger(projectId) || projectId <= 0) return { error: available.length ? 'Specify which canvas project to read' : 'Add a canonical project to the canvas first' };
      return creationSessionsApi.projectPrdContext(sessionId, projectId);
    },
  },   {
    // The canvas snapshot caps every string field, so a twenty-page document
    // dropped on the board reaches Brain as its first two thousand characters.
    // This is the document counterpart of canvas_query_dataset: the full body,
    // by page, so "summarise this" reads the file rather than its opening.
    name: 'canvas_read_document',
    description: 'Read the full written body of any object on this canvas that carries one — a Document, PRD, Knowledge page, Report, Note, or an imported Word or PDF file — one page at a time. The canvas snapshot truncates long bodies, so ALWAYS use this before summarizing, reviewing, rewriting, quoting, or answering questions about a document; never answer from the truncated snapshot text.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'Object id of the document. Omit when the canvas holds exactly one document-like object.' },
        page: { type: 'number', description: 'One-based page to read. Omit for the first page.' },
        pages: { type: 'number', description: 'How many consecutive pages to return, up to 6. Defaults to 3.' },
      },
    },
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; page?: number; pages?: number };
      const candidates = stage.nodes().filter((node) => canvasDocument(node.data));
      const target = args.objectId ? candidates.find((node) => node.id === args.objectId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which document to read. Documents on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No document with a written body is on this canvas.' };
      }
      const document = canvasDocument(target.data)!;
      const span = Math.max(1, Math.min(Math.round(Number(args.pages) || 3), 6));
      const first = Math.max(1, Math.min(Math.round(Number(args.page) || 1), document.pages.length));
      const returned = document.pages.slice(first - 1, first - 1 + span);
      return {
        objectId: target.id,
        title: target.data.title,
        ...(typeof target.data.fileName === 'string' ? { fileName: target.data.fileName } : {}),
        ...(typeof target.data.sourceFormat === 'string' ? { sourceFormat: target.data.sourceFormat } : {}),
        totalPages: document.pages.length,
        wordCount: document.wordCount,
        outline: document.headings,
        firstPage: first,
        pages: returned.map((body, index) => ({ page: first + index, body })),
        hasMore: first - 1 + returned.length < document.pages.length,
        readFromSource: true,
      };
    },
  },   {
    name: 'canvas_create_project_prd',
    description: 'Propose a complete canonical PRD assigned to a project and represented on the canvas. Use this—not canvas_add_object—for a project PRD, consolidated PRD, or requirements synthesis.',
    parameters: {
      type: 'object', required: ['title', 'markdown'], additionalProperties: false,
      properties: {
        projectId: { type: 'number', description: 'Canonical project id. Omit when exactly one project is present on the canvas.' },
        title: { type: 'string' }, markdown: { type: 'string', description: 'Complete authored PRD in Markdown.' },
        status: { type: 'string', enum: ['draft', 'ready', 'in_progress', 'complete'] },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      if (persistence !== 'server') return { error: 'Create an account and save the session before creating a canonical project PRD' };
      const args = raw as { projectId?: unknown; title?: unknown; markdown?: unknown; status?: unknown };
      const requested = Number(args.projectId);
      const projectNodes = canvasProjectNodes(ctx.nodes());
      const project = Number.isInteger(requested) && requested > 0
        ? projectNodes.find((node) => node.data.resourceId === `project:${requested}`)
        : projectNodes.length === 1 ? projectNodes[0] : undefined;
      if (!project) return { error: projectNodes.length ? 'Specify which canvas project owns this PRD' : 'Add a canonical project to the canvas first' };
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 160) : '';
      const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : '';
      if (!title || !markdown) return { error: 'A project PRD requires a title and complete Markdown content' };
      const projectId = canvasProjectId(project.data)!;
      const node = newNode('prd', { x: project.position.x + 390, y: project.position.y });
      node.data = {
        ...node.data, title, markdown, content: markdown,
        status: ['draft', 'ready', 'in_progress', 'complete'].includes(String(args.status)) ? String(args.status) : 'draft',
        sourceProjectId: projectId, canonicalPrdPending: true,
      };
      stage.addObject(`Create project PRD “${title}”`, node);
      stage.addConnection(
        `Assign ${title} to ${project.data.title}`,
        { id: crypto.randomUUID(), source: node.id, target: project.id, type: 'smoothstep', label: 'requirements for', data: { connectionKind: 'reference' } },
      );
      return { ok: true, proposed: true, projectId, object: { id: node.id, kind: 'prd', title }, persistence: 'canonical-after-review' };
    },
  }];
}
