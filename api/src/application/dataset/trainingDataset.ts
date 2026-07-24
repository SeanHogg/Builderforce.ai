/**
 * trainingDataset.ts — turn the run-outcome ledger into supervised (SFT) and
 * preference (DPO) fine-tuning datasets.
 *
 * The cookbook's premise is "adapt an open model on YOUR data". We sit on the
 * ideal corpus and, until now, spent it only on routing: every terminal run is
 * scored (`run_model_outcomes`) and its verbatim (prompt, completion) is kept
 * (`llm_traces`), yet that signal flowed solely into the learned-routing table.
 *
 * This module reuses the SAME reward signal the router already trusts (the 0..1
 * `score`, plus merged / ci_green / human_rejected) as a TRAINING label:
 *
 *   • SFT — every trace from a positive-outcome run becomes a {prompt, completion}
 *     example. Feed straight into the EvermindLM LoRA/QLoRA trainer, or export
 *     JSONL for any SFT pipeline.
 *   • DPO — for the SAME prompt, a completion from a high-scoring run is `chosen`
 *     and one from a low-scoring run is `rejected` (a real preference pair, not a
 *     cross-prompt guess), gated by a score margin.
 *
 * Reads are cached read-through, folded on the tenant's outcomes version token so
 * a new labeled run re-materializes the dataset (the scorer bumps the token).
 */

import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { runModelOutcomes, llmUsageLog, llmTraces } from '../../infrastructure/database/schema';
import { getOrSetCached, getCacheVersion, outcomesVersionKey } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/** One labeled trace row as read from the ledger join (before text extraction). */
export interface LabeledTrace {
  traceId: string;
  requestBody: string | null;
  responseBody: string | null;
  model: string;
  actionType: string;
  score: number;
  merged: boolean;
  ciGreen: boolean;
  humanRejected: boolean | null;
  terminalStatus: string;
}

export interface SftRecord {
  prompt: string;
  completion: string;
  meta: { model: string; actionType: string; score: number };
}

export interface DpoRecord {
  prompt: string;
  chosen: string;
  rejected: string;
  meta: { actionType: string; chosenScore: number; rejectedScore: number; margin: number };
}

export interface DatasetFilter {
  /** Restrict to one action type (e.g. 'code', 'chat'). Omit for all. */
  actionType?: string;
  /** Minimum outcome score to treat a run as a positive SFT example. Default 0.7. */
  minScore?: number;
  /** Require the run's PR to have merged. Default false. */
  requireMerged?: boolean;
  /** Require CI green. Default false. */
  requireCiGreen?: boolean;
  /** Max records. Default 500, hard-capped at 5000 (never an unbounded scan). */
  limit?: number;
}

export interface DpoFilter {
  actionType?: string;
  /** Minimum (chosenScore − rejectedScore) to emit a pair. Default 0.3. */
  minMargin?: number;
  /** Max rows scanned to build pairs. Default 1000, hard-capped at 5000. */
  scanLimit?: number;
}

const HARD_CAP = 5000;

// ── Pure text extraction (defensive — traces come from many vendors) ──────────

/** Pull the instruction text from an llm_traces.request_body (verbatim messages). */
export function extractPrompt(requestBody: string | null): string {
  if (!requestBody) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(requestBody);
  } catch {
    return requestBody.trim(); // already plain text
  }
  const messages = messagesOf(parsed);
  if (messages) {
    // The prompt is everything the model saw EXCEPT its own prior assistant turns.
    const parts = messages
      .filter((m) => m.role !== 'assistant')
      .map((m) => textOfContent(m.content))
      .filter((t) => t.length > 0);
    if (parts.length > 0) return parts.join('\n\n').trim();
  }
  if (typeof parsed === 'string') return parsed.trim();
  return requestBody.trim();
}

/** Pull the completion text from an llm_traces.response_body (many envelopes). */
export function extractCompletion(responseBody: string | null): string {
  if (!responseBody) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return responseBody.trim(); // already plain text
  }
  if (typeof parsed === 'string') return parsed.trim();
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    // Anthropic: { content: [{ type:'text', text }] }
    if (Array.isArray(o.content)) return textOfContent(o.content).trim();
    // OpenAI: { choices: [{ message: { content } }] }
    if (Array.isArray(o.choices)) {
      const first = o.choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
      const c = first?.message?.content ?? first?.text;
      if (c != null) return textOfContent(c).trim();
    }
    if (typeof o.text === 'string') return o.text.trim();
    if (typeof o.completion === 'string') return o.completion.trim();
  }
  return responseBody.trim();
}

interface ChatMessage {
  role: string;
  content: unknown;
}

function messagesOf(parsed: unknown): ChatMessage[] | null {
  if (Array.isArray(parsed)) return parsed as ChatMessage[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { messages?: unknown }).messages)) {
    return (parsed as { messages: ChatMessage[] }).messages;
  }
  return null;
}

/** Flatten a message `content` (string | array of text/parts) to plain text. */
function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          if (typeof p.text === 'string') return p.text;
          if (typeof p.content === 'string') return p.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// ── Pure dataset construction (fully unit-testable) ──────────────────────────

/** Whether a labeled trace qualifies as a positive SFT example. */
export function isPositiveExample(row: LabeledTrace, filter: DatasetFilter = {}): boolean {
  const minScore = filter.minScore ?? 0.7;
  if (row.terminalStatus !== 'completed') return false;
  if (row.humanRejected === true) return false;
  if (row.score < minScore) return false;
  if (filter.requireMerged && !row.merged) return false;
  if (filter.requireCiGreen && !row.ciGreen) return false;
  return true;
}

/** Map labeled traces → SFT records, keeping only positive examples with real text. */
export function toSftRecords(rows: LabeledTrace[], filter: DatasetFilter = {}): SftRecord[] {
  const seen = new Set<string>();
  const out: SftRecord[] = [];
  for (const row of rows) {
    if (seen.has(row.traceId)) continue;
    seen.add(row.traceId);
    if (!isPositiveExample(row, filter)) continue;
    const prompt = extractPrompt(row.requestBody);
    const completion = extractCompletion(row.responseBody);
    if (!prompt || !completion) continue;
    out.push({ prompt, completion, meta: { model: row.model, actionType: row.actionType, score: row.score } });
  }
  return out;
}

/**
 * Build DPO preference pairs. Groups traces by the SAME prompt (so chosen and
 * rejected answer the identical instruction — a valid preference pair), then
 * pairs the highest-scoring completion against the lowest, if the score margin
 * clears `minMargin`. Prompts with only one distinct-score completion are skipped.
 */
export function toDpoRecords(rows: LabeledTrace[], filter: DpoFilter = {}): DpoRecord[] {
  const minMargin = filter.minMargin ?? 0.3;
  const byPrompt = new Map<string, { prompt: string; actionType: string; completion: string; score: number }[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.traceId)) continue;
    seen.add(row.traceId);
    if (row.terminalStatus !== 'completed') continue;
    const prompt = extractPrompt(row.requestBody);
    const completion = extractCompletion(row.responseBody);
    if (!prompt || !completion) continue;
    const key = `${row.actionType} ${prompt}`;
    const bucket = byPrompt.get(key) ?? [];
    bucket.push({ prompt, actionType: row.actionType, completion, score: row.score });
    byPrompt.set(key, bucket);
  }
  const out: DpoRecord[] = [];
  for (const bucket of byPrompt.values()) {
    if (bucket.length < 2) continue;
    let best = bucket[0]!;
    let worst = bucket[0]!;
    for (const b of bucket) {
      if (b.score > best.score) best = b;
      if (b.score < worst.score) worst = b;
    }
    const margin = best.score - worst.score;
    if (margin < minMargin || best.completion === worst.completion) continue;
    out.push({
      prompt: best.prompt,
      chosen: best.completion,
      rejected: worst.completion,
      meta: { actionType: best.actionType, chosenScore: best.score, rejectedScore: worst.score, margin },
    });
  }
  return out;
}

/** Serialise records as JSONL (one JSON object per line) for any training pipeline. */
export function toJsonl(records: Array<SftRecord | DpoRecord>): string {
  return records.map((r) => JSON.stringify(r)).join('\n');
}

// ── Cached DB services ───────────────────────────────────────────────────────

function clampLimit(n: number | undefined, dflt: number): number {
  return Math.min(HARD_CAP, Math.max(1, n ?? dflt));
}

/** Read labeled traces for a tenant (positive-side query for SFT). */
async function readLabeledTraces(
  db: Db,
  tenantId: number,
  where: { actionType?: string; minScore: number; limit: number },
): Promise<LabeledTrace[]> {
  const conds = [
    eq(runModelOutcomes.tenantId, tenantId),
    isNotNull(runModelOutcomes.executionId),
    eq(llmTraces.success, true),
    gte(runModelOutcomes.score, where.minScore),
  ];
  if (where.actionType) conds.push(eq(runModelOutcomes.actionType, where.actionType));
  const rows = await db
    .select({
      traceId: llmTraces.traceId,
      requestBody: llmTraces.requestBody,
      responseBody: llmTraces.responseBody,
      model: runModelOutcomes.resolvedModel,
      actionType: runModelOutcomes.actionType,
      score: runModelOutcomes.score,
      merged: runModelOutcomes.merged,
      ciGreen: runModelOutcomes.ciGreen,
      humanRejected: runModelOutcomes.humanRejected,
      terminalStatus: runModelOutcomes.terminalStatus,
    })
    .from(runModelOutcomes)
    .innerJoin(llmUsageLog, eq(llmUsageLog.executionId, runModelOutcomes.executionId))
    .innerJoin(llmTraces, eq(llmTraces.traceId, llmUsageLog.traceId))
    .where(and(...conds))
    .limit(where.limit);
  return rows as LabeledTrace[];
}

/** SFT dataset for a tenant — cached, folded on the outcomes version token. */
export async function buildSftDataset(env: Env, db: Db, tenantId: number, filter: DatasetFilter = {}): Promise<SftRecord[]> {
  const minScore = filter.minScore ?? 0.7;
  const limit = clampLimit(filter.limit, 500);
  const ver = await getCacheVersion(env, outcomesVersionKey(tenantId));
  const key = `dataset:sft:${tenantId}:${filter.actionType ?? '*'}:${minScore}:${filter.requireMerged ? 'm' : ''}${filter.requireCiGreen ? 'c' : ''}:${limit}:${ver}`;
  return getOrSetCached(env, key, async () => {
    const rows = await readLabeledTraces(db, tenantId, { actionType: filter.actionType, minScore, limit });
    return toSftRecords(rows, filter);
  });
}

/** DPO dataset for a tenant — cached, folded on the outcomes version token. */
export async function buildDpoDataset(env: Env, db: Db, tenantId: number, filter: DpoFilter = {}): Promise<DpoRecord[]> {
  const scanLimit = clampLimit(filter.scanLimit, 1000);
  const ver = await getCacheVersion(env, outcomesVersionKey(tenantId));
  const key = `dataset:dpo:${tenantId}:${filter.actionType ?? '*'}:${filter.minMargin ?? 0.3}:${scanLimit}:${ver}`;
  return getOrSetCached(env, key, async () => {
    // DPO needs both high AND low scored traces (minScore 0 → the whole window).
    const rows = await readLabeledTraces(db, tenantId, { actionType: filter.actionType, minScore: 0, limit: scanLimit });
    return toDpoRecords(rows, filter);
  });
}
