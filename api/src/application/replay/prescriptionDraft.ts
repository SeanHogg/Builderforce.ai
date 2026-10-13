/**
 * The AI half of a prescription (PRD 33 §5.1.3, D13): phrase a finding a rule
 * already proved, draft the change, propose the acceptance — and nothing else.
 *
 * Through THE condense primitive (`llm/condense.ts`), sharing THE Insights AI budget
 * (`replayAiBudget`), at most {@link PRESCRIPTION_DRAFTS_PER_DAY} per site per day.
 * The model reads numbered lines only:
 *
 *   [#n] finding / impact facts            (from the finding, never invented)
 *   [#n] element <selector> "<label>"      the element map: selectors + labels, never page text
 *   [mm:ss #n] kind key "label"            cited recordings' timelines (`markLine`, as summaries use)
 *
 * and every prescription sentence must end with the `#n` it rests on; uncited
 * sentences are dropped by the SAME parser the summaries use (`parseCitations`). A
 * change may only target a selector from the element map; an acceptance metric the
 * rules do not know falls back to the rule's own.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayPrescriptions, replayRecordings } from '../../infrastructure/database/schema';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { markLine, digestHeader } from '../../domain/replay/visitDigest';
import { parseCitations } from '../../domain/replay/summaryCitations';
import { PRESCRIPTION_RULES, PRESCRIPTION_RULE_BY_ID } from '../../domain/replay/prescriptions/rules';
import type { PrescriptionAcceptance, SiteAggregates } from '../../domain/replay/prescriptions/types';
import { condenseTranscript } from '../llm/condense';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { withinReplayAiBudget } from './replayAiBudget';
import { prescriptionDraftCountKey } from './replayCacheKeys';
import { getMarks } from './replayChunkStore';
import { replayTelemetryDb } from './replayDatabase';
import { toRecordingSummary } from './replayReadModel';
import { recordingLocation } from './replayRecordingWriter';
import type { PrescriptionRow } from './prescriptionReads';
import type { ReplaySiteRecord } from './replaySites';

const SOURCE = 'application/replay/prescriptionDraft.ts';
/** Drafts per site per UTC day (§5.1.3 "top ≤5 new findings per site per day"). */
export const PRESCRIPTION_DRAFTS_PER_DAY = 5;
const RECORDINGS_PER_DRAFT = 3;
const MARKS_PER_RECORDING = 40;
const ELEMENTS_PER_DRAFT = 15;
const CHANGE_DESCRIPTION_MAX = 400;
const CHANGE_KINDS = new Set(['copy', 'layout', 'code', 'content']);
/** Every metric a rule accepts on. */
export const ACCEPTANCE_METRICS: ReadonlySet<string> = new Set(PRESCRIPTION_RULES.map((r) => r.acceptance.metric));

const SHAPE = 'You prescribe ONE fix for a website problem that the site owner\'s analytics already proved. '
  + 'Reply in exactly three labelled lines and nothing else:\n'
  + 'PRESCRIPTION: one to three plain sentences saying what to change and why. EVERY sentence must end with the #<n> of the line it rests on, e.g. "Make the Pay button respond to the first tap #4." A sentence you cannot tie to a line must not be written.\n'
  + 'CHANGE: one JSON object {"kind":"copy"|"layout"|"code"|"content","target":"<a selector from an element line, or empty>","description":"<the change, one sentence>"}\n'
  + 'ACCEPTANCE: <metric> <up|down> <minimum visits>, where metric is one of: '
  + [...new Set(PRESCRIPTION_RULES.map((r) => r.acceptance.metric))].join(', ')
  + '.\nRefer to elements by their label; never quote or invent page text.';

const UTC_DAY = (at: Date) => at.toISOString().slice(0, 10);

interface StoredFinding {
  params?: Record<string, unknown>;
  evidence?: Array<{ recordingId?: unknown }>;
  selector?: unknown;
  label?: unknown;
}

/** The numbered prompt for one finding, and how many citable lines it has. */
export async function buildDraftTranscript(
  env: Env | undefined,
  db: Db,
  site: ReplaySiteRecord,
  row: Pick<PrescriptionRow, 'ruleId' | 'pagePath' | 'finding' | 'impact'>,
  agg: Pick<SiteAggregates, 'elements'>,
): Promise<{ transcript: string; lines: number; selectors: Set<string> }> {
  const finding = (row.finding ?? {}) as StoredFinding;
  const lines: string[] = [];
  const add = (text: string) => lines.push(`[#${lines.length}] ${text.replace(/[\r\n]+/g, ' ')}`);

  const params = Object.entries(finding.params ?? {}).map(([k, v]) => `${k}=${String(v)}`).join(' · ');
  add(`finding ${row.ruleId}${row.pagePath ? ` on ${row.pagePath}` : ''}: ${params}`);
  const impact = (row.impact ?? {}) as Record<string, unknown>;
  if (impact.low !== undefined || impact.high !== undefined) {
    add(`impact over ${String(impact.horizonDays ?? 30)} days: ${String(impact.low ?? '?')} to ${String(impact.high ?? '?')} ${String(impact.unit ?? 'conversions')} (confidence ${String(impact.confidence ?? 'low')})`);
  }

  const selectors = new Set<string>();
  const elements = agg.elements
    .filter((e) => !row.pagePath || e.route === row.pagePath)
    .sort((a, b) => b.clicks + b.rage + b.dead - (a.clicks + a.rage + a.dead))
    .slice(0, ELEMENTS_PER_DRAFT);
  for (const e of elements) {
    selectors.add(e.selector);
    add(`element ${e.selector}${e.label ? ` "${e.label.replace(/"/g, "'").slice(0, 80)}"` : ''} · clicks ${e.clicks} rage ${e.rage} dead ${e.dead}`);
  }

  const ids = (finding.evidence ?? []).map((e) => String(e.recordingId ?? '')).filter(Boolean).slice(0, RECORDINGS_PER_DRAFT);
  const blocks: string[] = [];
  // The numbering is global: timeline lines continue after the fact and element lines.
  let next = lines.length;
  if (ids.length > 0) {
    const recordings = await replayTelemetryDb(env, db)
      .select()
      .from(replayRecordings)
      .where(and(eq(replayRecordings.tenantId, site.tenantId), eq(replayRecordings.siteId, site.id), inArray(replayRecordings.id, ids)));
    for (const recording of recordings) {
      const marks = (await getMarks(env as Env, recordingLocation(recording))).slice(0, MARKS_PER_RECORDING);
      const timeline = marks.map((mark) => markLine(mark, next++));
      blocks.push([`recording ${recording.id}`, ...digestHeader(toRecordingSummary(recording)), ...timeline].join('\n'));
    }
  }
  return { transcript: [...lines, ...blocks].join('\n'), lines: next, selectors };
}

export interface ParsedDraft {
  prescription: string;
  change: { kind: string; target: string | null; description: string } | null;
  acceptance: PrescriptionAcceptance | null;
}

/** Keep only what the rules allow: cited sentences, a change on a known element, a known metric. */
export function parseDraft(text: string, lineCount: number, selectors: ReadonlySet<string>): ParsedDraft {
  const field = (name: string): string => {
    const match = new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im').exec(text);
    return match ? match[1]!.trim() : '';
  };
  const prescription = parseCitations(field('PRESCRIPTION'), lineCount).summary;

  let change: ParsedDraft['change'] = null;
  try {
    const raw = JSON.parse(field('CHANGE') || 'null') as Record<string, unknown> | null;
    if (raw && typeof raw === 'object' && CHANGE_KINDS.has(String(raw.kind)) && typeof raw.description === 'string' && raw.description.trim()) {
      const target = typeof raw.target === 'string' && selectors.has(raw.target) ? raw.target : null;
      change = { kind: String(raw.kind), target, description: raw.description.trim().slice(0, CHANGE_DESCRIPTION_MAX) };
    }
  } catch {
    change = null;
  }

  let acceptance: PrescriptionAcceptance | null = null;
  const acc = /^([a-z_]+)\s+(up|down)\s+(\d{1,6})\b/i.exec(field('ACCEPTANCE'));
  if (acc && ACCEPTANCE_METRICS.has(acc[1]!.toLowerCase())) {
    acceptance = { metric: acc[1]!.toLowerCase(), direction: acc[2]!.toLowerCase() as 'up' | 'down', minVisits: Number(acc[3]) };
  }
  return { prescription, change, acceptance };
}

/**
 * Draft the given rows (already ranked, do-first first) until the site's daily cap
 * or the workspace's AI budget is spent. Returns how many were written.
 */
export async function draftPrescriptions(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  rows: readonly PrescriptionRow[],
  agg: Pick<SiteAggregates, 'elements'>,
  now: Date,
): Promise<number> {
  const capKey = prescriptionDraftCountKey(site.id, UTC_DAY(now));
  let used = Number((await peekCached<number>(env, capKey)) ?? 0);
  let written = 0;
  for (const row of rows) {
    if (used >= PRESCRIPTION_DRAFTS_PER_DAY) break;
    if (row.prescription) continue;
    if (!(await withinReplayAiBudget(env, site.tenantId, { now }))) break;
    used += 1;
    await setCached(env, capKey, used, { kvTtlSeconds: 2 * 86_400 });
    try {
      const prompt = await buildDraftTranscript(env, db, site, row, agg);
      const condensed = await condenseTranscript(env, site.tenantId, {
        transcript: prompt.transcript,
        header: 'A proved website finding, the page\'s element map and the timelines of visits that show it. Each line is numbered #n.',
        shape: SHAPE,
        maxTokens: 500,
      });
      if ('error' in condensed) continue;
      const draft = parseDraft(condensed.text, prompt.lines, prompt.selectors);
      if (!draft.prescription) continue;
      const rule = PRESCRIPTION_RULE_BY_ID.get(row.ruleId);
      const updated = await db
        .update(replayPrescriptions)
        .set({
          prescription: draft.prescription,
          change: draft.change,
          acceptance: draft.acceptance ?? rule?.acceptance ?? null,
          updatedAt: now,
        })
        .where(and(eq(replayPrescriptions.id, row.id), isNull(replayPrescriptions.prescription)))
        .returning({ id: replayPrescriptions.id });
      written += updated.length;
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'draftPrescription', context: { siteId: site.id, ruleId: row.ruleId } });
    }
  }
  return written;
}
