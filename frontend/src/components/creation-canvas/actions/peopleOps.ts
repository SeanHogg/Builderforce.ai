/** People operations on the board — rosters, references, the hiring funnel, interview slots and trigger evaluation. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { parseRosterCsv, type RosterRow } from '@/lib/academic/roster';
import { deadlineBearingKinds, specRefKey } from '@/lib/specObjects';
import { entryRowFromRecord, parseReferences } from '@/lib/academic/citations';
import { hiringApi } from '@/lib/hiringApi';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import { newNode } from '../canvasNodeHelpers';
import { evaluateCanvasTriggers, triggerUnboundHint } from '@/lib/canvasTriggers';
import { isDateComparator } from '@builderforce/creation-canvas-contract';
import type { CanvasActionContext } from './context';

export function canvasPeopleOpsActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, persistence, stage, t } = ctx;
  return [  {
    // Mirrors `canvas_import_resume`: a deterministic reader for a file a registrar
    // or a spreadsheet actually produces, so the roster field's own hint
    // ("canvas_import_roster reads a CSV") is real rather than aspirational.
    name: 'canvas_import_roster',
    description: 'Import a cohort roster from CSV text into a `cohort` object\'s `roster` field. Use this whenever someone pastes or uploads a class list, student list or roster export and asks to load it — never retype rows by hand. Accepts headers ref/id/student id, name, email, group/section and status (enrolled|withdrawn|auditing) in any order, or a headerless ref,name,email,group,status file. Parsed rows are ADDED to any roster already on the object; a learner already present (matched on ref) is left alone rather than duplicated.',
    parameters: {
      type: 'object', required: ['objectId', 'source'], additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The `cohort` object to import into.' },
        source: { type: 'string', description: 'The full CSV text.' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; source?: string };
      const target = ctx.nodes().find((node) => node.id === args.objectId && node.data.kind === 'cohort');
      if (!target) return { error: 'objectId must name a `cohort` object on this canvas' };
      const parsed = parseRosterCsv(String(args.source ?? ''));
      if (!parsed.length) {
        return { error: 'No roster rows were recognised in that text. Expected a header row naming ref/id, name, email, group and status in any order, or headerless ref,name,email,group,status rows.' };
      }
      const existing: RosterRow[] = Array.isArray(target.data.roster) ? target.data.roster as RosterRow[] : [];
      const seen = new Set(existing.map((row) => specRefKey(row?.ref)));
      const merged = [...existing, ...parsed.filter((row) => !seen.has(specRefKey(row.ref)))];
      stage.updateObject(`Import ${parsed.length} learners into ${target.data.title}`, target.id, { roster: merged, enrolledCount: merged.length });
      return { ok: true, proposed: true, objectId: target.id, imported: parsed.length, total: merged.length };
    },
  },   {
    // Mirrors `canvas_import_resume` for the other document format the academic set
    // documents but never wired: a `.bib`/`.ris` export, which every reference
    // manager already produces and nobody should have to retype.
    name: 'canvas_import_references',
    description: 'Import references from BibTeX (.bib) or RIS (.ris) text into a `bibliography` object\'s `entries` field. Use this whenever someone pastes or uploads a Zotero, Mendeley, EndNote, Scopus or PubMed export and asks to load their references — never retype them by hand and never write a pre-formatted citation string. The format is detected automatically. Parsed entries are ADDED to any already on the object.',
    parameters: {
      type: 'object', required: ['objectId', 'source'], additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The `bibliography` object to import into.' },
        source: { type: 'string', description: 'The full .bib or .ris text.' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; source?: string };
      const target = ctx.nodes().find((node) => node.id === args.objectId && node.data.kind === 'bibliography');
      if (!target) return { error: 'objectId must name a `bibliography` object on this canvas' };
      const records = parseReferences(String(args.source ?? ''));
      if (!records.length) return { error: 'No .bib or .ris entries were recognised in that text.' };
      const existing = Array.isArray(target.data.entries) ? target.data.entries : [];
      stage.updateObject(`Import ${records.length} references into ${target.data.title}`, target.id, { entries: [...existing, ...records.map(entryRowFromRecord)] });
      return { ok: true, proposed: true, objectId: target.id, imported: records.length };
    },
  },   {
    // The measurement half of every other hiring object. One `funnel` kind, bound to a
    // domain by VALUE — see SHARED_OBJECT_KINDS for why this is not `hiringFunnel`.
    name: 'canvas_measure_funnel',
    description: 'Read real stage conversion, time-in-stage and source-of-hire from the tenant own pipeline data, and write it onto a `funnel` object. Use this whenever the user asks where candidates are being lost, how long hiring takes, which source actually converts, or to measure any funnel — never author these numbers by hand. Returns the bottleneck stage with the number behind it.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The funnel object to write into. Omit to create one.' },
        funnelDomain: { type: 'string', enum: ['hiring'], description: 'Which funnel to measure. Only `hiring` reports live counts today; the kind is domain-neutral so the others bind without a new object.' },
        pipelineRef: { type: 'string', description: 'Restrict to one pipeline. Omit to measure every pipeline in the tenant.' },
        days: { type: 'number', minimum: 1, maximum: 365, description: 'Lookback window. Defaults to 90.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'A funnel reads tenant pipeline data, which needs a signed-in, saved Creation Canvas session.' };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; funnelDomain?: string; pipelineRef?: string; days?: number };
      const report = await hiringApi.funnel({
        ...(args.pipelineRef ? { pipelineRef: args.pipelineRef } : {}),
        ...(args.days ? { days: Math.max(1, Math.min(365, Math.floor(args.days))) } : {}),
      });
      if (!report.stages.length) {
        return { error: 'No pipeline movement in that window, so there is no funnel to draw. Say that rather than writing a card of zeroes.' };
      }
      const fields = {
        status: t('hiringFunnelMeasured'),
        funnelDomain: 'hiring',
        stages: report.stages,
        sourceBreakdown: report.sourceBreakdown,
        totalEntered: report.totalEntered,
        totalConverted: report.totalConverted,
        overallConversion: report.overallConversion,
        medianCycleDays: report.medianCycleDays,
        dateRange: report.dateRange,
        ...(report.bottleneck ? { bottleneck: report.bottleneck } : {}),
        fetchedAt: report.fetchedAt,
      };
      const patch = sanitizeCreationObjectPatch('funnel', fields);
      const existing = stage.nodes().filter((node) => node.data.kind === 'funnel');
      const target = args.objectId ? existing.find((node) => node.id === args.objectId) : existing.length === 1 ? existing[0] : undefined;
      if (target) {
        stage.updateObject(t('hiringFunnelUpdated', { title: target.data.title }), target.id, patch);
      } else {
        const node = newNode('funnel', { x: 320, y: 520 });
        node.data = { ...node.data, ...patch, title: t('hiringFunnelTitle') };
        stage.addObject(t('hiringFunnelCreated'), node);
      }
      return {
        ok: true, proposed: true,
        bottleneck: report.bottleneck, overallConversion: report.overallConversion,
        medianCycleDays: report.medianCycleDays, dateRange: report.dateRange,
        instruction: 'Lead with the bottleneck stage and the number of people lost there, not with the totals. These counts were read from the tenant own pipeline just now — report them with the window they cover.',
      };
    },
  },   {
    // The candidate-facing half of a solver that already existed and had exactly one
    // internal consumer. This is what removes the largest time sink in the role.
    name: 'canvas_offer_interview_slots',
    description: 'Propose interview times that clear every interviewer calendar and mint a link the CANDIDATE can use to book one themselves, writing it onto an `interviewLoop` object. Use this whenever the user asks to schedule, arrange or set up an interview — never propose times by reading calendars yourself, and never write a bookingUrl by hand, because an authored URL does not resolve. The interview must already exist in the hiring domain and its stage must name its interviewers.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        interviewId: { type: 'number', description: 'The hiring-domain interview to schedule. Find candidates for it with canvas_read_domain on the hiring domain, entity "interviews".' },
        objectId: { type: 'string', description: 'The interviewLoop object to write the link onto. Omit when exactly one is on the board.' },
        durationMinutes: { type: 'number', minimum: 5, maximum: 480, description: 'Slot length. Defaults to 45.' },
        candidateTimezone: { type: 'string', description: 'IANA zone of the CANDIDATE, e.g. "Europe/Berlin". Ask for it rather than assuming your own — an offer of 9am in one zone is 3am in another.' },
        count: { type: 'number', minimum: 1, maximum: 20, description: 'How many slots to offer. Defaults to 8.' },
      },
      required: ['interviewId'],
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Offering interview times reads real calendars, which needs a signed-in, saved Creation Canvas session.' };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { interviewId?: number; objectId?: string; durationMinutes?: number; candidateTimezone?: string; count?: number };
      const interviewId = Math.floor(Number(args.interviewId));
      if (!Number.isInteger(interviewId) || interviewId <= 0) return { error: 'Name the interview to schedule by its id.' };

      const result = await hiringApi.offerSlots(interviewId, {
        ...(args.durationMinutes ? { durationMinutes: Math.max(5, Math.min(480, Math.floor(args.durationMinutes))) } : {}),
        ...(args.candidateTimezone ? { candidateTimezone: args.candidateTimezone } : {}),
        ...(args.count ? { count: Math.max(1, Math.min(20, Math.floor(args.count))) } : {}),
      });
      if ('error' in result) return { error: result.error };

      const bookingUrl = `${window.location.origin}/book/${result.token}`;
      const fields = {
        status: t('hiringLoopOffered', { count: result.slots.length }),
        bookingUrl,
        bookingExpiresAt: result.expiresAt,
        ...(args.candidateTimezone ? { candidateTimezone: args.candidateTimezone } : {}),
      };
      const patch = sanitizeCreationObjectPatch('interviewLoop', fields);
      const loops = stage.nodes().filter((node) => node.data.kind === 'interviewLoop');
      const target = args.objectId ? loops.find((node) => node.id === args.objectId) : loops.length === 1 ? loops[0] : undefined;
      if (target) {
        stage.updateObject(t('hiringLoopUpdated', { title: target.data.title }), target.id, patch);
      } else {
        const node = newNode('interviewLoop', { x: 620, y: 320 });
        node.data = { ...node.data, ...patch, title: t('hiringLoopTitle') };
        stage.addObject(t('hiringLoopCreated'), node);
      }
      return {
        ok: true, proposed: true,
        slotCount: result.slots.length, expiresAt: result.expiresAt, bookingUrl,
        instruction: 'Give the user the booking link to send, and say how many slots it offers and when it expires. The link is shown ONCE — it cannot be recovered from the board later, so if they lose it, offer slots again.',
      };
    },
  },   {
    // What makes the board speak first.
    name: 'canvas_evaluate_triggers',
    description: `Evaluate every \`trigger\` object on this canvas and mark each armed, breached or unbound. A trigger watches EITHER a \`liveMetric\`'s number (below/above/equals/changes-by) OR a deadline on any object that carries one — kinds: ${deadlineBearingKinds().join(', ')} — with due-within (warn me N days before, and stay breached once past) or overdue-by (chase it once N days late). Call this after refreshing a metric, and whenever the user asks what needs their attention or what is coming up. A trigger whose metric has no value, or whose watched object carries no deadline, is reported unbound rather than healthy — silence about an unevaluated threshold is the failure this prevents.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'Evaluate one trigger. Omit to evaluate all of them.' } },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string };
      const board = stage.nodes();
      if (!board.some((node) => node.data.kind === 'trigger' && (!args.objectId || node.id === args.objectId))) {
        return { error: args.objectId ? 'That object is not a trigger on this canvas.' : 'No trigger objects are on this canvas.' };
      }
      const now = Date.now();
      const evaluatedAt = new Date(now).toISOString();
      // ONE traversal, shared with the nightly sweep — see `contract/triggers.ts` for why
      // a second copy of this comparison would be worse than no sweep at all.
      const resolved = evaluateCanvasTriggers(board, now, { onlyTriggerId: args.objectId });
      const results = resolved.map((entry) => {
        const patch = sanitizeCreationObjectPatch('trigger', {
          state: entry.evaluation.state,
          lastEvaluatedAt: evaluatedAt,
          status: t(`founderTriggerState_${entry.evaluation.state}`),
        });
        stage.updateObject(t('founderTriggerEvaluated', { title: entry.triggerTitle }), entry.triggerId, patch);
        return {
          id: entry.triggerId, title: entry.triggerTitle,
          watches: entry.watchedTitle, watchedKind: entry.watchedKind,
          deadlineField: entry.deadlineField,
          state: entry.evaluation.state, reason: entry.evaluation.reason, observed: entry.evaluation.observed,
          threshold: entry.threshold, comparator: entry.comparator,
          // For a deadline this is days remaining, negative once past — say so, so the
          // model reports "9 days overdue" rather than an unlabelled -9.
          observedMeans: isDateComparator(entry.comparator) ? 'days-remaining' : 'metric-value',
          hint: triggerUnboundHint(entry),
          thenDo: entry.thenDo,
        };
      });
      const breached = results.filter((result) => result.state === 'breached');
      const unbound = results.filter((result) => result.state === 'unbound');
      return {
        ok: true, proposed: true, evaluatedAt, results,
        breachedCount: breached.length, unboundCount: unbound.length,
        instruction: breached.length
          ? 'Lead your reply with the breached triggers and the action each one names in `thenDo`. For a deadline trigger, `observed` is DAYS REMAINING and is negative once the date has passed — say "renews in 12 days" or "9 days overdue", never the bare number. Do not bury a breach under the ones that are fine.'
          : unbound.length
            ? 'Say which triggers could NOT be evaluated and why — each carries a `hint` naming exactly what is missing. An unbound trigger is not a healthy one, and reporting "all clear" over it is the failure this tool exists to prevent.'
            : 'Confirm that every trigger was evaluated and none breached, naming what was checked.',
      };
    },
  }];
}
