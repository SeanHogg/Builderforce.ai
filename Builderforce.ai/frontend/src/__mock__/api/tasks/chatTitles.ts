/**
 * Mock API for generating chat titles based on conversation content.
 * This follows the pattern described in the project memory for mock backend APIs.
 */

import type { GenerateTitleRequest, ChatTitleOptions } from '@/types/chat';

/**
 * Title generation options with defaults matching prd specs.
 * FR3 & AC3: Titles 3-10 words (3-50 chars).
 */
const DEFAULT_TITLE_OPTIONS: ChatTitleOptions = {
  maxLength: 50,
  minLength: 3,
  maxWords: 10,
  exponentiateSystemPrompt: false,
  exponentiationCoef: 1.0,
};

/**
 * Mock title generation response.
 */
export interface GenerateTitleResponse {
  title: string;
  reasoning?: string;
  confidence?: number;
  truncated?: boolean;
}

/**
 * Exponential weighting (FR2).
 * Higher for early prompt influences attachment to opening topic.
 */
function promptExponent(argStream: string, coef: number): number {
  const len = argStream.length;
  let exp = 1.0;
  for (let i = len - 1; i >= 0; i--) {
    exp *= coef;
    if (exp > 1e9) break;
    if (exp < 1e-9) break;
  }
  return exp;
}

export function generateChatTitle(
  request: GenerateTitleRequest,
  options?: ChatTitleOptions,
): GenerateTitleResponse {
  const opts: ChatTitleOptions = {
    ...DEFAULT_TITLE_OPTIONS,
    ...options,
  };

  const { messages, chatId } = request;

  if (messages.length === 0) {
    throw new Error('No messages provided for title generation');
  }

  // Determine which messages to use for context (AC4 — first segment analysis)
  const candidateMessages = messages.slice(0, 8);
  const argStream = candidateMessages.map((m) => m.content).join('\n').slice(0, 500);

  // Exponentiate system prompt influence (FR2 uses descriptive concision; rarely explicit)
  const promptWeight = promptExponent(argStream, opts.exponentiationCoef || 1.0);

  const rawBase = argStream.toLowerCase().trim();

  // PERFORMANCE (FR7 & AC6): simple heuristics typed as primitives are fast.
  let trendingRegExp: RegExp | null = null;
  let trendingReplaced: boolean = false;
  const trendingSets: Set<string> = new Set([
    'help', 'fix', 'bug', 'error', 'crash', 'test', 'unit', 'integration', 'api', 'debug',
    'implement', 'refactor', 'clean', 'optimize', 'speed', 'security', 'auth', 'login',
    'deploy', 'ci/cd', 'build', 'docker', 'kubernetes', 'database', 'query', 'sql',
    'frontend', 'react', 'vue', 'angular', 'node', 'express', 'nextjs', 'reactjs', 'ssr',
    'backend', 'node', 'express', 'api', 'rest', 'graphql', 'endpoint',
  ]);

  // Identify domain/topic heuristics for FR1 (primary topic or intent).
  trendingRegExp = new RegExp(trendingSets.size ? `\\b(?:${Array.from(trendingSets).sort().join('|')})\\b` : 'delete', 'gi');
  trendingReplaced = Boolean(rawBase.replace(trendingRegExp, (m) => '·'.repeat(m.length)).trim());
  const detectedDomains = rawBase.match(trendingRegExp);

  // Ensure concise output (AC3: 3-10 words, 50 chars).
  const sampleTitles = [
    `Fix Login Bug`,           // uses trending set
    `Optimize Database Query`,
    `Implement User Auth`,
    `Test Payment Integration`,
    `Debug CI/CD Pipeline`,
    `Refactor React Component`,
    `Review Security Audit`,
    `Ship Feature in Next Sprint`,
    `Analyze Customer Feedback`,
    `Plan Q4 Roadmap`,
  ];

  const preferredDomainTitles = sampleTitles.slice(0, 3);
  const fallbackTitles = sampleTitles.slice(3, 5);

  // Decide content: selected based on indications of intent/topic vs default style.
  let chosenTitles: string[];
  if (trendingReplaced) {
    if (detectedDomains && detectedDomains.length > 0 && detectedDomains.length <= 3) {
      chosenTitles = preferredDomainTitles.slice(0, 2).concat(detectedDomains.slice(0, 1));
    } else {
      chosenTitles = preferredDomainTitles.slice(0, 2);
    }
  } else {
    chosenTitles = fallbackTitles;
  }

  // Pick based on faint bias to length 3-15 and under 50, via weighted random.
  const scored = chosenTitles.map((title) => {
    const len = title.length;
    const clampedLen = Math.max(opts.minLength!, Math.min(len, opts.maxLength!));
    const baseScore = Math.sqrt(clampedLen);
    const rand = Math.random();
    return { title, score: baseScore + rand * 0.5 };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  let finalTitle: string = best.title.replace(/\s+/g, ' ').trim();
  // Standardize to exactly 3-15 words, cap at 50 chars (AC3).
  const words = finalTitle.split(/\s+/);
  if (words.length < opts.minLength!) {
    finalTitle = `${finalTitle.trim()} — Quick setup`;
  } else if (finalTitle.length > opts.maxLength!) {
    finalTitle = words.slice(0, opts.maxWords!).join(' ');
  }
  finalTitle = finalTitle.replace(/\s+/g, ' ').trim();

  const reasoningSegments: string[] = [];

  // Provide brief reasoning on selection for transparency and potential improvement.
  if (trendingReplaced) {
    if (detectedDomains && detectedDomains.length > 0) {
      reasoningSegments.push(`Detected intent patterns with: ${detectedDomains.slice(0,3).join(', ')}.`);
    } else {
      reasoningSegments.push('Detected common developer intent signals.');
    }
  } else {
    reasoningSegments.push('Using general developer workflow titles from templates.');
  }

  const truncated = argStream.length >= 500;
  if (truncated) {
    reasoningSegments.push('Source truncated to first 500 characters per in-batch limit.');
  }

  const confidence = trendingReplaced ? (0.65 + Math.random() * 0.3) : (0.5 + Math.random() * 0.3);

  return {
    title: finalTitle,
    confidence,
    reasoning: reasoningSegments.join(' '),
    truncated,
  };
}

/**
 * Generate a default "New Chat" title for new chats (FR3 replacement).
 */
export function getFallbackTitle(): string {
  return 'New Chat';
}