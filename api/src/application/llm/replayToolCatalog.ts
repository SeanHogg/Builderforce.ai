/**
 * The Insights tools — "chat with your data" (PRD 33 §2.1, §8 S4c), spread into
 * `builtinMcpService`'s `CATALOG` like the chat-diagnostics tools.
 *
 * READ-ONLY. Each tool answers from the SAME services the Insights screen reads
 * (overview, funnels, the recording list through THE filter compiler, the cited
 * visit summary, the ranked prescriptions and one fix's draft — S4e), so a Brain
 * answer and the dashboard cannot disagree. Applying a fix is never a tool: it is a
 * person's action in Insights.
 *
 * SCOPE. A tool is asked about a PROJECT: the project must be the caller's
 * workspace's (`ctx.projects.getProject`), and the scope is that project's hosted
 * Insights site (`projectSiteDto`). A project without one is refused with a sentence
 * that says how to switch recording on — never another site.
 *
 * ENTITLEMENT. Advertised only to a workspace holding Insights
 * (`BUILTIN_TOOL_FEATURE_GATES` in `builtinToolEntitlements.ts`), and every run checks
 * it again — a model that names a tool it was not shown is refused, not served.
 */

import { parseReplayFilter, REPLAY_PRESCRIPTION_AREAS, type ReplayFilter } from '@builderforce/interaction-contract';
import { requireEnv, type BuiltinCtx, type BuiltinTool } from './builtinToolContext';
import { advertisedName } from './toolNaming';
import { tenantHasFeature } from '../tenant/featureEntitlements';
import { projectSiteDto } from '../replay/replaySiteAdmin';
import { ReplayOverviewService } from '../replay/ReplayOverviewService';
import { ReplayFunnelService } from '../replay/ReplayFunnelService';
import { ReplayReadService } from '../replay/ReplayReadService';
import { summarizeRecording } from '../replay/replaySummaries';
import { getPrescription, listPrescriptions } from '../replay/prescriptionReads';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { oneLineDigest } from '../../domain/replay/visitDigest';

type Json = Record<string, unknown>;

const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const FILTER = {
  type: 'object',
  description: 'Optional ReplayFilter: { all: [{ field, op, value }] } — fields device, browser, os, country, referrer, entryPath, exitPath, visitedPath, clickedSelector, frustration, durationMs, activeMs, pageCount, release, smartEvent, tag, converted, variant, issue.',
} as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

export const REPLAY_TOOL_IDS = [
  'replay.overview',
  'replay.funnel_evaluate',
  'replay.search_recordings',
  'replay.summarize_recording',
  'replay.prescriptions',
  'replay.prescription_draft',
] as const;

const SEARCH_LIMIT_MAX = 25;
/** Fixes one `replay.prescriptions` answer lists. */
const PRESCRIPTIONS_LIMIT = 15;

/** The project's hosted Insights site as a scope, or a refusal the model can act on. */
async function scopeFor(ctx: BuiltinCtx, args: Json): Promise<ReplayScope> {
  const env = requireEnv(ctx, 'Insights tools need the worker environment and are unavailable here.');
  if (!(await tenantHasFeature(env, ctx.tenantId, ctx.userId ?? null, 'sessionReplay'))) {
    throw new Error('This workspace does not have Insights. Install Insights from the marketplace to analyse visits.');
  }
  const projectId = Number(args.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('projectId is required: the project whose hosted site to read.');
  await ctx.projects.getProject(projectId, ctx.tenantId); // Forbidden / NotFound outside the workspace
  const site = await projectSiteDto(env, ctx.db, ctx.tenantId, projectId);
  if (!site || site.status !== 'active') {
    throw new Error(`Project ${projectId} is not recording visits. Switch recording on in the project's Measure ▸ Visitors to use Insights tools.`);
  }
  return { tenantId: ctx.tenantId, siteId: site.id };
}

function filterArg(args: Json): ReplayFilter | null {
  if (args.filter === undefined || args.filter === null) return null;
  const filter = parseReplayFilter(args.filter);
  if (!filter) throw new Error('filter is not a valid ReplayFilter ({ all: [{ field, op, value }] }, at most 12 clauses).');
  return filter;
}

const daysArg = (args: Json): number | undefined => (args.days === undefined ? undefined : Number(args.days));

export const REPLAY_TOOLS: BuiltinTool[] = [
  {
    tool: 'replay.overview',
    mutates: false,
    description:
      'The Insights overview for a project\'s site: sessions, pages per session, active time, frustration shares (rage, dead, quick back, excessive scroll, error), the daily trend and the top pages, referrers, countries, devices and browsers. '
      + 'Unfiltered numbers are exact over every session; with a filter they are estimated from kept recordings (`estimated: true` — say "about").',
    parameters: obj({ projectId: N, days: N, filter: FILTER }, ['projectId']),
    run: async (ctx, args) => {
      const scope = await scopeFor(ctx, args);
      return new ReplayOverviewService(ctx.env!, ctx.db).overview(scope, { days: daysArg(args), filter: filterArg(args) });
    },
  },
  {
    tool: 'replay.funnel_evaluate',
    mutates: false,
    description:
      'Evaluate one of the site\'s saved funnels over kept recordings: visits per step, conversion from the previous step, median time between steps and who dropped at each step (recording ids to watch). '
      + `Omit funnelId to list the saved funnels first. Results are estimates; \`truncated\` means only the newest 20,000 recordings were read. Use ${advertisedName('replay.summarize_recording')} on a dropped recording to see why.`,
    parameters: obj({ projectId: N, funnelId: S, days: N, filter: FILTER }, ['projectId']),
    run: async (ctx, args) => {
      const scope = await scopeFor(ctx, args);
      const funnels = new ReplayFunnelService(ctx.env!, ctx.db);
      if (typeof args.funnelId !== 'string' || !args.funnelId) return { funnels: await funnels.list(scope) };
      return funnels.evaluate(scope, args.funnelId, { days: daysArg(args), filter: filterArg(args) });
    },
  },
  {
    tool: 'replay.search_recordings',
    mutates: false,
    description:
      'Find kept recordings of a project\'s site matching a filter (newest first): each with its id, start time and a one-line digest (device, duration, entry → exit, pages, frustration, converted). '
      + `Pass a returned id to ${advertisedName('replay.summarize_recording')} for a cited summary.`,
    parameters: obj({ projectId: N, days: N, filter: FILTER, limit: N }, ['projectId']),
    run: async (ctx, args) => {
      const scope = await scopeFor(ctx, args);
      const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Number(args.limit) || 10));
      const page = await new ReplayReadService(ctx.env!, ctx.db).listRecordings(scope, { days: daysArg(args), filter: filterArg(args), limit });
      return {
        recordings: page.items.map((item) => ({ id: item.id, startedAt: item.startedAt, digest: oneLineDigest(item) })),
        more: page.nextCursor !== null,
      };
    },
  },
  {
    tool: 'replay.summarize_recording',
    mutates: false,
    description:
      'A cited 3–5 sentence summary of ONE kept recording: what the visitor tried, where they struggled, how it ended. Each sentence ends with #<n>, the timeline moment it describes. '
      + 'Counts against the workspace\'s daily Insights AI limit when it has to be generated.',
    parameters: obj({ projectId: N, recordingId: S }, ['projectId', 'recordingId']),
    run: async (ctx, args) => {
      const scope = await scopeFor(ctx, args);
      return summarizeRecording(ctx.env!, ctx.db, scope, String(args.recordingId ?? ''), { actorId: ctx.userId ?? null });
    },
  },
  {
    tool: 'replay.prescriptions',
    mutates: false,
    description:
      'The ranked fixes for a project\'s site (Insights prescriptions): each with its rule, area, page, status, the measured finding (title params + cited recordings), '
      + 'the impact range over 30 days (an estimate is null when either cohort has under 100 visits — say "not enough data yet"), and, once measured, the verdict. '
      + `Optional area: ${REPLAY_PRESCRIPTION_AREAS.join(', ')}. Use ${advertisedName('replay.prescription_draft')} for one fix's drafted change.`,
    parameters: obj({ projectId: N, area: S, status: S }, ['projectId']),
    run: async (ctx, args) => {
      const scope = await scopeFor(ctx, args);
      const list = await listPrescriptions(ctx.env!, ctx.db, scope, {
        area: typeof args.area === 'string' ? args.area : null,
        status: typeof args.status === 'string' ? args.status : null,
      });
      return {
        prescriptions: list.slice(0, PRESCRIPTIONS_LIMIT).map((p) => ({
          id: p.id, rank: p.rank, ruleId: p.ruleId, area: p.area, page: p.pagePath, status: p.status,
          finding: p.finding.params, impact: p.impact, prescription: p.prescription, measured: p.measured,
        })),
        more: list.length > PRESCRIPTIONS_LIMIT,
      };
    },
  },
  {
    tool: 'replay.prescription_draft',
    mutates: false,
    description:
      'One fix\'s draft: the cited prescription, the drafted change (kind, target element, description), the acceptance metric and the finding it rests on. Read-only — '
      + 'applying a fix (a ticket, a preview, a test, a follow-up) is a person\'s action in Insights.',
    parameters: obj({ projectId: N, prescriptionId: S }, ['projectId', 'prescriptionId']),
    run: async (ctx, args) => {
      const scope = await scopeFor(ctx, args);
      const p = await getPrescription(ctx.env!, ctx.db, scope, String(args.prescriptionId ?? ''));
      return {
        id: p.id, ruleId: p.ruleId, page: p.pagePath, status: p.status,
        prescription: p.prescription, change: p.change, acceptance: p.acceptance, finding: p.finding, impact: p.impact,
      };
    },
  },
];
