/**
 * Derived lead score — never a column.
 *
 * A lead is an anonymous visitor who typed a prompt (or ran a tool, or opened
 * Brain). The console ranks them so a salesperson opens the hottest one first.
 * Storing the number would drift from the prompts and visits it is computed
 * from; computing it here, from the same row `GuestPromptService` already
 * returns, keeps 3NF and means a prompt erased from the drawer drops the score
 * on the next read.
 *
 * Caps are 0–100 so the number is comparable across days without a histogram.
 * The parts exist so an operator who disagrees with the rank can see WHY, not
 * so the UI has four gauges.
 */
import { clamp } from '../../domain/shared/numbers';
import { DAY_MS } from '../../domain/shared/time';

export interface LeadScoreInput {
  promptCount: number;
  lastPrompt: string | null;
  guestChatCount: number;
  toolRuns: number;
  visitCount: number;
  converted: boolean;
  isPaid: boolean;
  lastSeenAt: string | Date | null;
  /** Frozen in tests so a recency bucket cannot flap. */
  nowMs?: number;
}

export interface LeadScoreParts {
  /** 0–40. Whether they stated intent, and how much of a brief it was. */
  intent: number;
  /** 0–30. Visits, Brain turns, diagnostic runs. */
  engagement: number;
  /** 0–15. How recently they were last seen. */
  recency: number;
  /** 0–15. Registered / paid — the funnel close. */
  conversion: number;
}

export interface LeadScore {
  total: number;
  parts: LeadScoreParts;
}

const INTENT_MAX = 40;
const ENGAGEMENT_MAX = 30;
const RECENCY_MAX = 15;
const CONVERSION_MAX = 15;


const clampRounded = (n: number, min: number, max: number): number =>
  clamp(Number.isFinite(n) ? Math.round(n) : min, min, max);

function asMs(value: string | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value) return Date.parse(value);
  return Number.NaN;
}

/**
 * How much of a brief the last prompt is. Length bands plus two cheap signals
 * that separate "hi" from "build me a kanban for my agency": more than one
 * word, and a question mark. A paste over 800 characters is usually a dump,
 * not a sharper brief, so it loses a little.
 */
export function promptQuality(prompt: string | null): number {
  if (!prompt) return 0;
  const len = prompt.length;
  let quality = 0;
  if (len >= 8) quality += 4;
  if (len >= 40) quality += 4;
  if (len >= 80) quality += 3;
  if (len >= 200 && len < 800) quality += 2;
  if (len >= 800) quality -= 3;
  if (/\s/.test(prompt) && len >= 12) quality += 2;
  if (prompt.includes('?')) quality += 2;
  return clampRounded(quality, 0, 15);
}

function intentPart(input: LeadScoreInput): number {
  const count = Number(input.promptCount) || 0;
  if (count <= 0) return 0;
  const volume = Math.min(25, 8 + count * 5);
  return clampRounded(volume + promptQuality(input.lastPrompt), 0, INTENT_MAX);
}

function engagementPart(input: LeadScoreInput): number {
  const visits = Math.min(12, (Number(input.visitCount) || 0) * 4);
  const chats = Math.min(12, (Number(input.guestChatCount) || 0) * 3);
  const tools = Math.min(6, (Number(input.toolRuns) || 0) * 2);
  return clampRounded(visits + chats + tools, 0, ENGAGEMENT_MAX);
}

function recencyPart(input: LeadScoreInput): number {
  const last = asMs(input.lastSeenAt);
  if (!Number.isFinite(last)) return 0;
  const age = (input.nowMs ?? Date.now()) - last;
  if (age < 0) return RECENCY_MAX;
  if (age < DAY_MS) return 15;
  if (age < 7 * DAY_MS) return 10;
  if (age < 30 * DAY_MS) return 5;
  return 0;
}

function conversionPart(input: LeadScoreInput): number {
  if (input.isPaid) return CONVERSION_MAX;
  if (input.converted) return 10;
  return 0;
}

/** Rank one lead from the fields the console already has. 0–100, never stored. */
export function scoreLead(input: LeadScoreInput): LeadScore {
  const parts: LeadScoreParts = {
    intent: intentPart(input),
    engagement: engagementPart(input),
    recency: recencyPart(input),
    conversion: conversionPart(input),
  };
  return {
    total: clampRounded(parts.intent + parts.engagement + parts.recency + parts.conversion, 0, 100),
    parts,
  };
}
