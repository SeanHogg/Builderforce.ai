/** Résumé work on the board — screen a stack against a role, render variants, import one. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { activeResumeRevision, createResumeFamily, renderResumeMarkdown, RESUME_TEMPLATE_IDS, RESUME_TEMPLATES, resumeDocumentFromJson, resumeDocumentFromNode, resumeNodePatch, type ResumeTemplateId, resumeTemplateVariants } from '@/lib/canvasResume';
import type { CreationFlowNode } from '../CreationNode';
import { resolveObjectRef } from '@/domains/canvas/domain/canvasBoard';
import { screenCandidates } from '@/lib/canvasResumeScreening';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import { newNode } from '../canvasNodeHelpers';
import { canvasDocument } from '@/lib/canvasDocuments';
import { resumeDocumentFromText, resumeDocumentIsThin } from '@builderforce/creation-canvas-contract';
import { importResumeFromAttachment } from '@/lib/resumeImportApi';
import type { CanvasActionContext } from './context';

export function canvasRecruitingActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, persistence, stage, t } = ctx;
  return [  {
    // ── The recruiter's funnel ─────────────────────────────────────────────────
    // Ranks the resume objects ALREADY on this board against a posting on this board,
    // in the browser. No network call and no account: the deterministic analyzer the
    // resume builder already uses, composed N:1 — which is the half a recruiter needs
    // and the 1:1 version could not express.
    name: 'canvas_screen_resumes',
    description: 'Rank every `resume` object on this canvas against a `jobPosting` on this canvas, write the ranking onto a `shortlist` object, and attach every scored resume to a `candidate` — updating the candidate that already names it through resumeRef, or creating one carrying nothing the resume does not state. Use this whenever the user asks who to interview, who the strongest candidates are, or to screen a pile of CVs — never rank them by reading the resumes yourself, because the result must be reproducible and defensible. Scores four declared signals (keyword coverage, whether matched terms appear in a dated role, demonstrated years against the stated level, and how recently the skills were used) and returns the evidence and the gaps for every candidate. It reads no demographic or personal attribute and adds nothing a resume does not state.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        postingObjectId: { type: 'string', description: 'The jobPosting to rank against. Omit when exactly one is on the board.' },
        shortlistObjectId: { type: 'string', description: 'An existing shortlist to write into. Omit to create one.' },
        resumeObjectIds: { type: 'array', items: { type: 'string' }, description: 'Restrict the screen to these resume objects. Omit to screen every resume on the board.' },
        level: { type: 'string', description: 'Override the seniority read from the posting, e.g. "senior", "staff", "graduate".' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { postingObjectId?: string; shortlistObjectId?: string; resumeObjectIds?: string[]; level?: string };
      const all = stage.nodes();

      const postings = all.filter((node) => node.data.kind === 'jobPosting');
      const posting = args.postingObjectId ? postings.find((node) => node.id === args.postingObjectId) : postings.length === 1 ? postings[0] : undefined;
      if (!posting) {
        return { error: postings.length
          ? `Specify which posting to rank against. On this canvas: ${postings.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No jobPosting object is on this canvas. Create one with canvas_add_object first — a ranking with no posting behind it is an opinion.' };
      }

      const wanted = new Set(args.resumeObjectIds ?? []);
      const resumes = all.filter((node) => node.data.kind === 'resume' && (wanted.size === 0 || wanted.has(node.id)));
      if (!resumes.length) {
        return { error: 'No resume objects are on this canvas to screen. Add them first — this ranks what is on the board, and never invents a candidate.' };
      }

      // The posting's own fields ARE the job description. Reading them rather than asking
      // the model to restate them is what keeps the ranking reproducible: the same board
      // screened twice must produce the same order.
      const jobDescription = [
        posting.data.title, posting.data.summary, posting.data.level, posting.data.location,
        ...(Array.isArray(posting.data.mustHaves) ? posting.data.mustHaves : []),
        ...(Array.isArray(posting.data.niceToHaves) ? posting.data.niceToHaves : []),
        ...(Array.isArray(posting.data.responsibilities)
          ? (posting.data.responsibilities as Array<Record<string, unknown>>).map((item) => `${item?.title ?? ''} ${item?.detail ?? ''}`)
          : []),
      ].filter(Boolean).join('\n');
      if (jobDescription.trim().length < 40) {
        return { error: 'That posting has no requirements to screen against. Author its mustHaves, niceToHaves and responsibilities first — screening against an empty posting ranks nobody honestly.' };
      }

      // Read through the SAME accessor the template engine uses. Reading
      // `data.resumeDocument` directly found nothing on an imported résumé — that field
      // is consumed when the family is built and never persisted — so a board full of
      // real CVs screened as "no parsed resume document".
      const candidates = resumes.flatMap((node) => {
        const document = resumeDocumentFromNode(node.data);
        return document ? [{ ref: node.id, name: String(node.data.title || node.id), document }] : [];
      });
      if (!candidates.length) {
        return { error: 'None of those resume objects carries a parsed resume document yet, so there is nothing to score.' };
      }

      // ── THE ATTACHMENT ────────────────────────────────────────────────────────
      //
      // A `resume` is a DOCUMENT and a `candidate` is the PERSON the funnel is about, and
      // this tool used to score the first while ignoring the second: it ranked a pile of
      // documents, wrote a shortlist naming document ids, and left every candidate card
      // on the board with the empty `fitScore` its own hint says may only be set "from a
      // scored shortlist" — an instruction with no mechanism behind it.
      //
      // So the screen resolves each résumé to the candidate that names it (through
      // `candidate.resumeRef`), scores the PERSON, and where a résumé has no candidate it
      // proposes one — carrying nothing the résumé does not state. That is what makes the
      // funnel one funnel: after a screen, every scored document has a person attached to
      // it, and every person carries the score and the posting they were ranked against.
      const candidateNodes = all.filter((node) => node.data.kind === 'candidate');
      const attachedTo = new Map<string, CreationFlowNode>();
      for (const node of candidateNodes) {
        const resume = resolveObjectRef(resumes, 'resume', node.data.resumeRef);
        if (resume && !attachedTo.has(resume.id)) attachedTo.set(resume.id, node);
      }

      const level = typeof args.level === 'string' && args.level.trim() ? args.level : String(posting.data.level ?? '');
      const report = screenCandidates(candidates, { jobDescription, ...(level ? { level } : {}) });

      // Every scored résumé now ends beside a person: the candidate that already names it
      // gets the score, and a résumé nobody has claimed gets a candidate proposed for it.
      const attachments = report.ranked.map((entry) => {
        const resume = resumes.find((node) => node.id === entry.ref);
        const existing = attachedTo.get(entry.ref);
        if (existing) {
          stage.updateObject(
            t('hiringCandidateScored', { title: String(existing.data.title) }),
            existing.id,
            sanitizeCreationObjectPatch('candidate', { fitScore: entry.score, postingRef: posting.id, stage: t('hiringCandidateStageScreened') }),
          );
          return { ref: entry.ref, candidateId: existing.id };
        }
        // NOTHING INVENTED. The name, headline and location are read out of the résumé
        // itself; consent, source and stage are left for a person, because a candidate
        // card that asserts a lawful basis nobody recorded is worse than one that shows
        // the gap.
        const basics = (resume ? resumeDocumentFromNode(resume.data) : null)?.basics;
        const node = newNode('candidate', {
          x: (resume?.position.x ?? 320) + 40,
          y: (resume?.position.y ?? 320) + 260,
        });
        node.data = {
          ...node.data,
          ...sanitizeCreationObjectPatch('candidate', {
            headline: String(basics?.label ?? ''),
            location: [basics?.location?.city, basics?.location?.region].filter(Boolean).join(', '),
            resumeRef: entry.ref,
            postingRef: posting.id,
            fitScore: entry.score,
            stage: t('hiringCandidateStageScreened'),
          }),
          title: String(basics?.name ?? entry.candidate),
        };
        stage.addObject(t('hiringCandidateCreated', { title: String(node.data.title) }), node);
        return { ref: entry.ref, candidateId: node.id };
      });
      const candidateIdFor = new Map(attachments.map((entry) => [entry.ref, entry.candidateId]));

      const fields = {
        status: t('hiringShortlistRanked', { count: report.ranked.length }),
        postingRef: posting.id,
        method: report.method,
        ranked: report.ranked.map((entry) => ({
          rank: entry.rank,
          candidate: entry.candidate,
          // The join the ranking never carried. A row that names only a document is a row
          // nothing downstream can advance, interview or make an offer to.
          candidateRef: candidateIdFor.get(entry.ref) ?? '',
          score: entry.score,
          evidence: entry.evidence.join(', '),
          gaps: entry.gaps.join(', '),
        })),
        knockouts: report.knockouts,
        reviewedCount: report.reviewedCount,
      };
      const patch = sanitizeCreationObjectPatch('shortlist', fields);

      const shortlists = all.filter((node) => node.data.kind === 'shortlist');
      const target = args.shortlistObjectId ? shortlists.find((node) => node.id === args.shortlistObjectId) : undefined;
      if (target) {
        stage.updateObject(t('hiringShortlistUpdated', { title: target.data.title }), target.id, patch);
      } else {
        const node = newNode('shortlist', { x: 320, y: 320 });
        node.data = { ...node.data, ...patch, title: t('hiringShortlistFor', { title: String(posting.data.title || '') }) };
        stage.addObject(t('hiringShortlistCreated'), node);
      }

      return {
        ok: true, proposed: true,
        reviewedCount: report.reviewedCount,
        ranked: report.ranked.map((entry) => ({ rank: entry.rank, candidate: entry.candidate, score: entry.score, signals: entry.signals })),
        candidates: attachments.length,
        instruction: 'Report the top of this ranking and the reason each one is there, using the evidence and gaps on the shortlist. Every scored resume now has a `candidate` card carrying its fit score and the posting it was ranked against, so advance, interview and offer act on the PERSON and never on the document. This is a READING ORDER, not a decision: never say a candidate was rejected, and never restate a score without the gap that goes with it.',
      };
    },
  },   {
    /**
     * THE TEMPLATE ENGINE, EXPOSED.
     *
     * "Make ten versions of my résumé in different styles" had no route to this engine,
     * so the only path left was ten `canvas_add_object` calls, each retyping the whole
     * document. Measured 2026-08-15: the turn spent four minutes, produced nothing, and
     * hung. One call now renders every requested style from the one document — no model
     * round-trip per version, and no chance of a variant inventing a job.
     */
    name: 'canvas_render_resume_variants',
    description: `Render one résumé in several visual styles at once, using the built-in template engine. USE THIS — never canvas_add_object — whenever the user asks for their résumé in different styles, templates, designs, layouts or formats, or for "N versions" of it. It re-renders the EXISTING document, so every version states the same history; authoring them by hand would be slower and would let the versions drift apart. Reads the résumé from a resume object, or from a dataset holding an imported JSON Resume. Available templates: ${RESUME_TEMPLATES.map((template) => `${template.id} (${template.industry})`).join(', ')}.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The resume or dataset object holding the résumé. Omit when exactly one is on the board.' },
        templateIds: { type: 'array', items: { type: 'string', enum: [...RESUME_TEMPLATE_IDS] }, description: 'Templates to render, in order. Omit to render the requested count across the full catalog.' },
        count: { type: 'number', description: 'How many styles to render when templateIds is omitted. Capped at the number of templates that exist.' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; templateIds?: unknown; count?: number };
      const all = stage.nodes();
      const sources = all.filter((node) => resumeDocumentFromNode(node.data) !== null);
      const source = args.objectId ? all.find((node) => node.id === args.objectId) : sources.length === 1 ? sources[0] : undefined;
      if (!source) {
        return { error: sources.length
          ? `Specify which object holds the résumé. On this canvas: ${sources.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No structured résumé is on this canvas — this restyles a real document and never invents one. If a CV is here as a document, an imported PDF or a Word file, call canvas_import_resume on it FIRST and then restyle the object that produces.' };
      }
      const document = resumeDocumentFromNode(source.data);
      if (!document) return { error: `Object ${source.id} does not hold a readable résumé document, so there is nothing to restyle.` };

      const requested = Array.isArray(args.templateIds)
        ? args.templateIds.filter((id): id is ResumeTemplateId => RESUME_TEMPLATE_IDS.includes(id as ResumeTemplateId))
        : [];
      const count = Math.max(1, Math.min(Number(args.count) || requested.length || RESUME_TEMPLATES.length, RESUME_TEMPLATES.length));
      // Deduplicated and then topped up from the catalog, so "ten versions" is ten
      // DIFFERENT designs rather than the same template repeated to reach a number.
      const templateIds = [...new Set([...requested, ...RESUME_TEMPLATES.map((template) => template.id)])].slice(0, Math.max(count, requested.length));

      const variants = resumeTemplateVariants(document, templateIds, { title: String(source.data.title || '') });
      const created: Array<{ id: string; templateId: string; title: string }> = [];
      for (const variant of variants) {
        const node = stage.createObject('resume');
        node.data = {
          ...node.data,
          ...resumeNodePatch(variant.family),
          title: activeResumeRevision(variant.family).title,
          subtitle: variant.industry,
          status: t('resumeEditor.statusOriginal'),
        };
        node.style = { width: 560, height: 620 };
        stage.addObject(`Render résumé · ${variant.industry}`, node);
        created.push({ id: node.id, templateId: variant.templateId, title: String(node.data.title) });
      }
      return {
        ok: true, proposed: true,
        renderedFrom: source.id,
        variants: created,
        instruction: 'These are already on the board, fully rendered. Name the styles you produced in one short line and stop — do NOT create them again with canvas_add_object, and do not retype any résumé content.',
      };
    },
  },   {
    /**
     * THE MISSING FIRST STEP.
     *
     * A person drops their CV on the board and asks to turn it into a résumé. Every
     * tool that follows — restyling, screening, tailoring, the ATS check — needs a
     * `resume` object, and there was NO tool that made one from a document already on
     * the canvas. So the model did the only thing left: it asked the person to paste
     * the text of the file it was looking at (measured 2026-08-16). This reads the
     * document the importer already extracted and structures it with the same
     * deterministic reader the upload route uses — no model, no upload, no tokens.
     *
     * A SCAN has no extracted text for that deterministic reader to find — it
     * lands as a `file` attachment instead of a `document`. Its bytes survive
     * that landing (see `attachmentBytesStrategy`), so when there is no
     * readable document this falls back to escalating the attachment's
     * retained bytes through the same OCR route the résumé editor's own file
     * picker already uses. That costs a model call and needs a tenant to bill
     * it to, so it only runs on a signed-in, server-persisted session.
     */
    name: 'canvas_import_resume',
    description: 'Turn a résumé that is already on this canvas — as a document, imported PDF, Word file, text, or a scanned/photographed attachment — into a real `resume` object. USE THIS — never canvas_add_object, and never ask the user to paste their résumé — whenever someone asks to convert, import, parse, structure or "make a resume from" a file on the board. A document with real text is structured deterministically; a scan with no text layer is OCR’d server-side (signed-in sessions only). The resulting object is what canvas_render_resume_variants and canvas_screen_resumes need.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The document, file or note holding the résumé. Omit when the canvas holds exactly one document.' },
        title: { type: 'string', description: 'Title for the résumé object. Defaults to the name on the document, or the source file name.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; title?: string };
      const all = stage.nodes();
      // A résumé that is ALREADY structured is not a source: re-importing it would
      // replace a parsed document with a re-parse of its own rendering.
      const candidates = all.filter((node) => canvasDocument(node.data) && resumeDocumentFromNode(node.data) === null);
      // A scan carries no `canvasDocument` — its markdown was never extracted — but
      // if its bytes were retained at drop time, it is still a résumé source.
      const scanCandidates = all.filter((node) => node.data.kind === 'file'
        && (typeof node.data.sourceFileKey === 'string' || typeof node.data.sourceDataUrl === 'string'));
      const source = args.objectId
        ? all.find((node) => node.id === args.objectId)
        : candidates.length === 1 ? candidates[0]
          : candidates.length === 0 && scanCandidates.length === 1 ? scanCandidates[0]
            : undefined;
      if (!source) {
        const named = [...candidates, ...scanCandidates];
        return { error: named.length
          ? `Specify which object holds the résumé. On this canvas: ${named.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'Nothing on this canvas carries readable résumé text. If a file landed as an attachment saying its text could not be extracted, it is a scan with no text layer — say so and ask for a PDF or Word file with real text, or for the text itself. Do NOT ask the user to paste a document whose text this canvas already holds.' };
      }

      let markdown = canvasDocument(source.data)?.markdown?.trim() ?? '';
      let document = markdown ? resumeDocumentFromText(markdown) : null;
      let ocr: { provider: string; model: string } | null = null;

      if (!document) {
        const sourceFileKey = typeof source.data.sourceFileKey === 'string' ? source.data.sourceFileKey : undefined;
        const sourceDataUrl = typeof source.data.sourceDataUrl === 'string' ? source.data.sourceDataUrl : undefined;
        if (!sourceFileKey && !sourceDataUrl) {
          return { error: `Object ${source.id} carries no readable text, so there is nothing to structure. If it is a scanned PDF, say that plainly rather than guessing at its contents.` };
        }
        if (persistence !== 'server') {
          return { error: `Object ${source.id} is a scan with no text layer. Reading it takes a model call billed to a workspace, which needs a signed-in, saved Creation Canvas session — ask the person to sign in, then try again.` };
        }
        const attachmentName = typeof source.data.fileName === 'string' ? source.data.fileName : String(source.data.title || 'attachment');
        try {
          const result = await importResumeFromAttachment({ fileName: attachmentName, sourceFileKey, sourceDataUrl });
          document = resumeDocumentFromJson(result.document);
          ocr = { provider: result.provider, model: result.model };
        } catch (error) {
          return { error: `Reading the scan failed: ${error instanceof Error ? error.message : String(error)}` };
        }
        if (!document) return { error: `Object ${source.id} could not be read into a résumé — the scan may be unclear, or not a résumé.` };
        markdown = renderResumeMarkdown(document);
      }

      const embedded = typeof document.basics?.name === 'string' ? document.basics.name.trim() : '';
      const fileName = typeof source.data.fileName === 'string' ? source.data.fileName.replace(/\.[^.]+$/, '') : '';
      const title = String(args.title ?? '').trim() || embedded || fileName || String(source.data.title || t('resumeEditor.untitledVersion'));
      const family = createResumeFamily({ title, markdown, document });

      const node = stage.createObject('resume', { x: source.position.x + 460, y: source.position.y });
      node.data = { ...node.data, ...resumeNodePatch(family), title, status: t('resumeEditor.statusOriginal') };
      node.style = { width: 560, height: 620 };
      stage.addObject(t('resumeImportedFrom', { title: String(source.data.title || '') }), node);

      // A structure this thin means the source had no recognisable sections. It is
      // still the person's résumé and still lands on the board — but the turn must
      // say so, because the alternative is a confident empty document.
      const thin = resumeDocumentIsThin(document);
      return {
        ok: true, proposed: true,
        objectId: node.id,
        importedFrom: source.id,
        name: embedded,
        workEntries: Array.isArray(document.work) ? document.work.length : 0,
        educationEntries: Array.isArray(document.education) ? document.education.length : 0,
        skills: Array.isArray(document.skills) ? document.skills.length : 0,
        thin,
        ...(ocr ? { readVia: 'ocr' as const, provider: ocr.provider, model: ocr.model } : {}),
        instruction: thin
          ? 'The résumé is on the board, but few sections were recognised. Say which ones came through and offer to fill the rest from what the person tells you — do NOT invent employers, dates or skills, and do not retype the document.'
          : 'The résumé is on the board, fully structured. Report what came through in one short line and offer the next step — restyling with canvas_render_resume_variants, or screening against a posting. Do NOT retype any of its content.',
      };
    },
  }];
}
