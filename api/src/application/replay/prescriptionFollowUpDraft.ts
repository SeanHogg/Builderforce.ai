/**
 * "Draft a new sequence" for a Follow up (PRD 33 §5.1.4, D13): two or three
 * email steps answering the objection or hesitation a sales finding already
 * proved — drafted for a person to edit before anyone is enrolled, never sent
 * from here.
 *
 * Through THE condense primitive (`llm/condense.ts`), sharing THE Insights AI
 * budget (`replayAiBudget`). The model reads numbered lines built ONLY from the
 * finding a rule proved and its cited evidence:
 *
 *   [#n] finding <rule> on <page>: <params>     (the objection pattern, the cohort)
 *   [#n] prescription: <the cited prescription> (already cited when it was written)
 *   [#n] evidence: recording <id> at <mm:ss>    (the cited visits, by reference)
 *
 * — no page text, no timelines, no element labels. Each drafted step must cite the
 * lines it rests on; an uncited or out-of-range step is dropped, and a draft with
 * fewer than one step left falls back to the fixed first touch (`firstTouchDraft`).
 * The draft is cached per fix for a day, so re-opening the preview costs nothing.
 */

import type { ReplayFollowUpSequenceDraftDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { asJsonRecord, extractJsonObject } from '../../domain/shared/json';
import { ValidationError } from '../../domain/shared/errors';
import { clock } from '../../domain/replay/visitDigest';
import { condenseTranscript } from '../llm/condense';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { takeReplayAiBudget } from './replayAiBudget';
import { followUpSequenceDraftKey } from './replayCacheKeys';
import { firstTouchDraft } from './prescriptionFollowUp';
import type { PrescriptionRow } from './prescriptionReads';

const SOURCE = 'application/replay/prescriptionFollowUpDraft.ts';
/** Steps a drafted (or edited) sequence may hold. */
export const FOLLOW_UP_SEQUENCE_STEPS_MAX = 3;
export const FOLLOW_UP_SEQUENCE_NAME_MAX = 80;
export const FOLLOW_UP_SUBJECT_MAX = 200;
export const FOLLOW_UP_BODY_MAX = 2_000;
export const FOLLOW_UP_DELAY_MAX_DAYS = 60;
const EVIDENCE_LINES_MAX = 3;
const DRAFT_TTL = { kvTtlSeconds: 86_400 };

const SHAPE = 'You draft a short sales follow-up email cadence for people a website\'s analytics already identified. '
  + 'Reply with ONE JSON object and nothing else:\n'
  + '{"name":"<a name for the cadence, under 60 characters>","steps":[{"delayDays":<days after enrolment; 0 for the first step>,"subject":"<email subject>","body":"<plain-text email body; you may use {{firstName}}>","cites":[<the n of every #n line this step rests on>]}]}\n'
  + `Write 2 or ${FOLLOW_UP_SEQUENCE_STEPS_MAX} steps, a few days apart. Each step answers the objection or hesitation the lines name and lists the lines it rests on in "cites"; a step you cannot tie to a line must not be written. `
  + 'Never quote page text, never invent prices, discounts, features or promises, and never mention that the person was recorded, watched or tracked.';

/** Pure: the numbered lines the model may cite — the finding and its cited evidence only. */
export function followUpSequenceTranscript(row: Pick<PrescriptionRow, 'ruleId' | 'pagePath' | 'finding' | 'prescription'>): { transcript: string; lines: number } {
  const finding = asJsonRecord(row.finding);
  const lines: string[] = [];
  const add = (text: string) => lines.push(`[#${lines.length}] ${text.replace(/[\r\n]+/g, ' ')}`);
  const params = Object.entries(asJsonRecord(finding.params)).map(([k, v]) => `${k}=${String(v)}`).join(' · ');
  add(`finding ${row.ruleId}${row.pagePath ? ` on ${row.pagePath}` : ''}: ${params}`);
  if (row.prescription) add(`prescription: ${row.prescription}`);
  const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
  for (const item of evidence.slice(0, EVIDENCE_LINES_MAX)) {
    const e = asJsonRecord(item);
    const id = String(e.recordingId ?? '');
    if (id) add(`evidence: recording ${id} at ${clock(Number(e.atMs) || 0)}`);
  }
  return { transcript: lines.join('\n'), lines: lines.length };
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Bounded text in which only the placeholders the cadence runner renders survive
 * (`{{firstName}}`, `{{name}}`); any other `{{…}}` is removed rather than sent as is.
 */
const copy = (value: unknown, max: number): string => text(value, max)
  .replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_m, name: string) => (name === 'firstName' || name === 'name' ? `{{${name}}}` : ''))
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

/** Steps in firing order, each a day or more after the one before, clamped. */
function ordered(steps: ReplayFollowUpSequenceDraftDto['steps']): ReplayFollowUpSequenceDraftDto['steps'] {
  const sorted = [...steps].sort((a, b) => a.delayDays - b.delayDays);
  let last = -1;
  return sorted.map((step) => {
    const delayDays = Math.min(FOLLOW_UP_DELAY_MAX_DAYS, Math.max(last + 1, step.delayDays));
    last = delayDays;
    return { ...step, delayDays };
  });
}

/** Pure: keep only cited steps (a `cites` entry inside `[0, lineCount)`), clamped and ordered. */
export function parseSequenceDraft(raw: string, lineCount: number): ReplayFollowUpSequenceDraftDto | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  const steps = (Array.isArray(json.steps) ? json.steps : [])
    .map(asJsonRecord)
    .filter((s) => Array.isArray(s.cites) && s.cites.some((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < lineCount))
    .map((s) => ({
      subject: copy(s.subject, FOLLOW_UP_SUBJECT_MAX),
      body: copy(s.body, FOLLOW_UP_BODY_MAX),
      delayDays: Math.round(Math.max(0, Number(s.delayDays) || 0)),
    }))
    .filter((s) => s.subject && s.body)
    .slice(0, FOLLOW_UP_SEQUENCE_STEPS_MAX);
  if (steps.length === 0) return null;
  return { name: text(json.name, FOLLOW_UP_SEQUENCE_NAME_MAX) || 'Follow-up', steps: ordered(steps) };
}

/** The fixed first touch as a one-step sequence — what a person gets when the model gives nothing usable. */
function templateSequence(row: Pick<PrescriptionRow, 'ruleId' | 'pagePath'>): ReplayFollowUpSequenceDraftDto {
  const first = firstTouchDraft(row);
  return { name: `Follow-up: ${row.pagePath ?? row.ruleId}`.slice(0, FOLLOW_UP_SEQUENCE_NAME_MAX), steps: [{ ...first, delayDays: 0 }] };
}

/**
 * The drafted sequence for one fix: cached, else one model call on THE budget
 * (429 `ReplayAiLimitError` once it is spent — the person asked, so they are told).
 */
export async function draftFollowUpSequence(
  env: Env,
  tenantId: number,
  row: Pick<PrescriptionRow, 'id' | 'ruleId' | 'pagePath' | 'finding' | 'prescription'>,
  now: Date,
): Promise<ReplayFollowUpSequenceDraftDto> {
  const key = followUpSequenceDraftKey(row.id);
  const cached = await peekCached<ReplayFollowUpSequenceDraftDto>(env, key);
  if (cached) return cached;
  await takeReplayAiBudget(env, tenantId, { now });
  const prompt = followUpSequenceTranscript(row);
  let draft: ReplayFollowUpSequenceDraftDto | null = null;
  try {
    const condensed = await condenseTranscript(env, tenantId, {
      transcript: prompt.transcript,
      header: 'A proved sales finding about identified visitors, and the evidence it cites. Each line is numbered #n.',
      shape: SHAPE,
      maxTokens: 900,
    });
    if (!('error' in condensed)) draft = parseSequenceDraft(condensed.text, prompt.lines);
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'draftFollowUpSequence', context: { ruleId: row.ruleId } });
  }
  if (!draft) return templateSequence(row);
  await setCached(env, key, draft, DRAFT_TTL);
  return draft;
}

/** The sequence a person confirmed (edited or not), validated: 400 when nothing sendable is left. */
export function cleanSequenceDraft(input: unknown): ReplayFollowUpSequenceDraftDto {
  const raw = asJsonRecord(input);
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .slice(0, FOLLOW_UP_SEQUENCE_STEPS_MAX)
    .map(asJsonRecord)
    .map((s) => ({
      subject: copy(s.subject, FOLLOW_UP_SUBJECT_MAX),
      body: copy(s.body, FOLLOW_UP_BODY_MAX),
      delayDays: Math.round(Math.max(0, Number(s.delayDays) || 0)),
    }))
    .filter((s) => s.subject && s.body);
  if (steps.length === 0) throw new ValidationError('A new sequence needs at least one step with a subject and a body');
  const name = text(raw.name, FOLLOW_UP_SEQUENCE_NAME_MAX);
  if (!name) throw new ValidationError('A new sequence needs a name');
  return { name, steps: ordered(steps) };
}
