/**
 * AI use-case registry — callers declare intent, never a model. The facade
 * resolves intent → model chain → vendor at dispatch time.
 *
 * Adding a use case:
 *   1. Add the literal to `AIUseCase`.
 *   2. Add a spec to `AI_USE_CASES`.
 *
 * Migration note: this registry is the union of the three apps that consume
 * Builderforce.ai (Builderforce itself, burnrateos.com, hired.video). Each
 * caller passes its own intent string; the chain composer picks the right
 * vendor at dispatch time.
 */

export type ModelCapability = 'text' | 'vision' | 'ocr' | 'embed';

export type AIUseCase =
  // ── Builderforce.ai (IDE + agent training)
  | 'ide.chat'
  | 'ide.code_complete'
  | 'training.dataset_generate'
  | 'training.dataset_evaluate'
  | 'agent.inference'

  // ── CoderClaw agent roles
  | 'coder.code'
  | 'coder.review'
  | 'coder.test'
  | 'coder.debug'
  | 'coder.refactor'
  | 'coder.document'
  | 'coder.architect'

  // ── burnrateos.com — Coach
  | 'coach.chat'
  | 'coach.insight'
  | 'coach.classify'

  // ── burnrateos.com — Studio (creative long-form)
  | 'studio.compose'
  | 'studio.script'
  | 'studio.brief'

  // ── burnrateos.com — Investor
  | 'pitch_deck.generate'
  | 'investor.update'

  // ── burnrateos.com — Generic
  | 'ask.general'

  // ── burnrateos.com — Productivity tools
  | 'tool.classify_email'
  | 'tool.categorize_expense'
  | 'tool.contract_analyze'
  | 'tool.competitor_scan'
  | 'tool.feature_score'
  | 'tool.market_research'
  | 'tool.health_score'
  | 'tool.journey_insight'

  // ── Capabilities (vision / OCR / embeddings)
  | 'vision.describe'
  | 'ocr.extract'
  | 'embed.text'

  // ── hired.video — Match
  | 'match'
  | 'match_tailor'
  | 'match_insights'

  // ── hired.video — Resume / skills / parsing
  | 'resume_roast'
  | 'skill_extract'
  | 'job_parser'
  | 'autofill'

  // ── hired.video — Studio (creative)
  | 'article_writer'
  | 'studio_script'
  | 'studio_edit_script'
  | 'studio_misc'
  | 'linkedin_post'

  // ── hired.video — Interview
  | 'interview_questions'
  | 'interview_analyze'

  // ── hired.video — Career & dashboard
  | 'chat'
  | 'career'
  | 'discovery'
  | 'dashboard_summary';

export interface UseCaseSpec {
  capability: ModelCapability;
  /** Preferred chain in dispatch order. The composer prepends an admin override
   *  and appends cross-vendor fallbacks before walking the chain. */
  preferredChain: string[];
  maxTokens: number;
  temperature?: number;
  toolsExpected: boolean;
  description: string;
}

// ---------------------------------------------------------------------------
// Reusable preferred chains (DRY: each chain pattern is named once)
// ---------------------------------------------------------------------------

/** General reasoning, free tier. */
const FAST_FREE_CHAIN = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'google/gemma-4-31b-it:free',
];

/** Fast classification / sub-200ms TTFT. */
const CLASSIFY_CHAIN = [
  'llama3.1-8b',                          // Cerebras — fast first-token
  'meta-llama/llama-3.3-70b-instruct:free',
];

/** Strict-JSON / structured output. */
const STRUCTURED_CHAIN = [
  'qwen/qwen3-coder:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
];

/** Long-form creative (paid first → free fallback). */
const CREATIVE_PAID_CHAIN = [
  'anthropic/claude-3.7-sonnet',
  'openai/gpt-4.1',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
];

/** Long-context analysis. */
const LONG_CONTEXT_CHAIN = [
  'qwen/qwen3-next-80b-a3b-instruct:free', // 262K context
  'z-ai/glm-4.5-air:free',                 // 128K context
  'meta-llama/llama-3.3-70b-instruct:free',
];

/** Coder-tuned (code completion, refactor, review). */
const CODER_CHAIN = [
  'qwen/qwen3-coder:free',
  'qwen3-coder-next',                      // Ollama
  'meta-llama/llama-3.3-70b-instruct:free',
];

// ---------------------------------------------------------------------------
// Use-case map
// ---------------------------------------------------------------------------

export const AI_USE_CASES: Record<AIUseCase, UseCaseSpec> = {
  // ── Builderforce.ai
  'ide.chat': {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 1024, toolsExpected: true,
    description: 'In-IDE AI assistant chat',
  },
  'ide.code_complete': {
    capability: 'text', preferredChain: CODER_CHAIN,
    maxTokens: 512, temperature: 0.2, toolsExpected: false,
    description: 'IDE code completion',
  },
  'training.dataset_generate': {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 1500, temperature: 0.7, toolsExpected: false,
    description: 'Dataset generation for fine-tuning (worker/training.ts)',
  },
  'training.dataset_evaluate': {
    capability: 'text', preferredChain: STRUCTURED_CHAIN,
    maxTokens: 800, temperature: 0.1, toolsExpected: false,
    description: 'Independent judge scoring of generated outputs',
  },
  'agent.inference': {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 2048, toolsExpected: true,
    description: 'Workforce custom-agent inference (workforce-<agentId> route)',
  },

  // ── CoderClaw 7-role agents
  'coder.code': {
    capability: 'text', preferredChain: CODER_CHAIN,
    maxTokens: 4096, temperature: 0.3, toolsExpected: true,
    description: 'CoderClaw Code role — implementation',
  },
  'coder.review': {
    capability: 'text', preferredChain: STRUCTURED_CHAIN,
    maxTokens: 2048, temperature: 0.2, toolsExpected: false,
    description: 'CoderClaw Review role — adversarial code review',
  },
  'coder.test': {
    capability: 'text', preferredChain: CODER_CHAIN,
    maxTokens: 3072, temperature: 0.3, toolsExpected: true,
    description: 'CoderClaw Test role — write/run tests',
  },
  'coder.debug': {
    capability: 'text', preferredChain: CODER_CHAIN,
    maxTokens: 3072, temperature: 0.4, toolsExpected: true,
    description: 'CoderClaw Debug role — investigate failures',
  },
  'coder.refactor': {
    capability: 'text', preferredChain: CODER_CHAIN,
    maxTokens: 4096, temperature: 0.3, toolsExpected: true,
    description: 'CoderClaw Refactor role — restructure existing code',
  },
  'coder.document': {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 2048, temperature: 0.5, toolsExpected: false,
    description: 'CoderClaw Document role — README / API docs',
  },
  'coder.architect': {
    capability: 'text', preferredChain: CREATIVE_PAID_CHAIN,
    maxTokens: 4096, temperature: 0.5, toolsExpected: false,
    description: 'CoderClaw Architect role — high-level design (paid first for reasoning)',
  },

  // ── burnrateos.com — Coach
  'coach.chat': {
    capability: 'text',
    preferredChain: ['qwen/qwen3-next-80b-a3b-instruct:free', ...FAST_FREE_CHAIN],
    maxTokens: 1024, toolsExpected: true,
    description: 'AI CxO Coach conversational chat',
  },
  'coach.insight': {
    capability: 'text',
    preferredChain: ['qwen/qwen3-next-80b-a3b-instruct:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    maxTokens: 600, temperature: 0.4, toolsExpected: false,
    description: 'Active Coach proactive insight generation',
  },
  'coach.classify': {
    capability: 'text', preferredChain: CLASSIFY_CHAIN,
    maxTokens: 200, temperature: 0.1, toolsExpected: false,
    description: 'Coach lightweight classification (lifecycle stage, etc.)',
  },

  // ── burnrateos.com — Studio
  'studio.compose': {
    capability: 'text', preferredChain: CREATIVE_PAID_CHAIN,
    maxTokens: 2048, temperature: 0.7, toolsExpected: false,
    description: 'Marketing copy generation',
  },
  'studio.script': {
    capability: 'text', preferredChain: CREATIVE_PAID_CHAIN,
    maxTokens: 4096, temperature: 0.8, toolsExpected: false,
    description: 'Long-form script writing',
  },
  'studio.brief': {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 800, temperature: 0.5, toolsExpected: false,
    description: 'Short-form briefs / outlines',
  },

  // ── burnrateos.com — Investor
  'pitch_deck.generate': {
    capability: 'text', preferredChain: CREATIVE_PAID_CHAIN,
    maxTokens: 4096, temperature: 0.5, toolsExpected: false,
    description: 'Pitch deck slide drafting',
  },
  'investor.update': {
    capability: 'text', preferredChain: CREATIVE_PAID_CHAIN,
    maxTokens: 2048, temperature: 0.5, toolsExpected: false,
    description: 'Investor update / quarterly note',
  },

  // ── burnrateos.com — Generic ask
  'ask.general': {
    capability: 'text',
    preferredChain: ['qwen/qwen3-next-80b-a3b-instruct:free', ...FAST_FREE_CHAIN],
    maxTokens: 1024, toolsExpected: true,
    description: 'Generic AI ask (fallback intent)',
  },

  // ── burnrateos.com — Productivity tools
  'tool.classify_email': {
    capability: 'text', preferredChain: CLASSIFY_CHAIN,
    maxTokens: 200, temperature: 0.1, toolsExpected: false,
    description: 'Email classification (lead / support / vendor / other)',
  },
  'tool.categorize_expense': {
    capability: 'text', preferredChain: CLASSIFY_CHAIN,
    maxTokens: 100, temperature: 0.1, toolsExpected: false,
    description: 'Expense category classification',
  },
  'tool.contract_analyze': {
    capability: 'text', preferredChain: LONG_CONTEXT_CHAIN,
    maxTokens: 2048, temperature: 0.3, toolsExpected: false,
    description: 'Contract terms / risk extraction (long context)',
  },
  'tool.competitor_scan': {
    capability: 'text', preferredChain: LONG_CONTEXT_CHAIN,
    maxTokens: 1024, toolsExpected: true,
    description: 'Competitor intel scan (web research tool)',
  },
  'tool.feature_score': {
    capability: 'text', preferredChain: STRUCTURED_CHAIN,
    maxTokens: 600, temperature: 0.3, toolsExpected: false,
    description: 'Feature ROI / RICE scoring',
  },
  'tool.market_research': {
    capability: 'text', preferredChain: LONG_CONTEXT_CHAIN,
    maxTokens: 1500, toolsExpected: true,
    description: 'Market research summary',
  },
  'tool.health_score': {
    capability: 'text', preferredChain: CLASSIFY_CHAIN,
    maxTokens: 400, temperature: 0.2, toolsExpected: false,
    description: 'Customer health score recompute',
  },
  'tool.journey_insight': {
    capability: 'text', preferredChain: LONG_CONTEXT_CHAIN,
    maxTokens: 800, temperature: 0.4, toolsExpected: false,
    description: 'Customer journey / next-best-action insight',
  },

  // ── Capabilities
  'vision.describe': {
    capability: 'vision',
    preferredChain: ['google/gemini-2.5-pro', 'openai/gpt-4.1'],
    maxTokens: 1024, toolsExpected: false,
    description: 'Vision model — image-in, text-out',
  },
  'ocr.extract': {
    capability: 'ocr',
    preferredChain: ['google/gemini-2.5-pro'],
    maxTokens: 2000, toolsExpected: false,
    description: 'OCR text extraction from receipt / scanned document',
  },
  'embed.text': {
    capability: 'embed',
    preferredChain: [], // Embeddings live on a different endpoint; intent reserved for future routing.
    maxTokens: 0, toolsExpected: false,
    description: 'Text embedding (vector) — not yet wired to vendor',
  },

  // ── hired.video — Match
  match: {
    capability: 'text', preferredChain: CLASSIFY_CHAIN,
    maxTokens: 800, temperature: 0.0, toolsExpected: false,
    description: 'Job/candidate match scoring (sub-200ms TTFT)',
  },
  match_tailor: {
    capability: 'text', preferredChain: STRUCTURED_CHAIN,
    maxTokens: 1500, temperature: 0.3, toolsExpected: false,
    description: 'Resume tailoring for a specific job (strict JSON)',
  },
  match_insights: {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 1024, temperature: 0.5, toolsExpected: false,
    description: 'Match-result insights / recommendations',
  },

  // ── hired.video — Resume / skills / parsing
  resume_roast: {
    capability: 'text',
    preferredChain: ['nousresearch/hermes-3-llama-3.1-405b:free', ...FAST_FREE_CHAIN],
    maxTokens: 1500, temperature: 0.85, toolsExpected: false,
    description: 'Resume roast (creative critique)',
  },
  skill_extract: {
    capability: 'text', preferredChain: STRUCTURED_CHAIN,
    maxTokens: 1024, temperature: 0.0, toolsExpected: false,
    description: 'Skill extraction from resume (strict JSON)',
  },
  job_parser: {
    capability: 'text', preferredChain: STRUCTURED_CHAIN,
    maxTokens: 1500, temperature: 0.0, toolsExpected: false,
    description: 'Job description parsing (strict JSON)',
  },
  autofill: {
    capability: 'text',
    preferredChain: ['google/gemma-4-31b-it:free', ...FAST_FREE_CHAIN],
    maxTokens: 600, temperature: 0.2, toolsExpected: false,
    description: 'Form autofill suggestions',
  },

  // ── hired.video — Studio (creative)
  article_writer: {
    capability: 'text',
    preferredChain: ['nousresearch/hermes-3-llama-3.1-405b:free', ...FAST_FREE_CHAIN],
    maxTokens: 4096, temperature: 0.85, toolsExpected: false,
    description: 'Long-form article writing',
  },
  studio_script: {
    capability: 'text', preferredChain: CREATIVE_PAID_CHAIN,
    maxTokens: 4096, temperature: 0.7, toolsExpected: false,
    description: 'Studio script generation (paid first)',
  },
  studio_edit_script: {
    capability: 'text', preferredChain: CREATIVE_PAID_CHAIN,
    maxTokens: 4096, temperature: 0.5, toolsExpected: false,
    description: 'Studio script editing pass',
  },
  studio_misc: {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 1024, toolsExpected: false,
    description: 'Studio miscellaneous (titles, hooks, etc.)',
  },
  linkedin_post: {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 800, temperature: 0.7, toolsExpected: false,
    description: 'LinkedIn post composition',
  },

  // ── hired.video — Interview
  interview_questions: {
    capability: 'text', preferredChain: STRUCTURED_CHAIN,
    maxTokens: 1500, temperature: 0.6, toolsExpected: false,
    description: 'Interview question generation',
  },
  interview_analyze: {
    capability: 'text', preferredChain: STRUCTURED_CHAIN,
    maxTokens: 2048, temperature: 0.3, toolsExpected: false,
    description: 'Interview transcript analysis',
  },

  // ── hired.video — Career & dashboard
  chat: {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 1024, temperature: 0.7, toolsExpected: true,
    description: 'Generic chat (hired.video general assistant)',
  },
  career: {
    capability: 'text', preferredChain: FAST_FREE_CHAIN,
    maxTokens: 1500, temperature: 0.6, toolsExpected: false,
    description: 'Career resilience / coaching responses',
  },
  discovery: {
    capability: 'text',
    preferredChain: ['google/gemma-4-31b-it:free', ...FAST_FREE_CHAIN],
    maxTokens: 800, temperature: 0.4, toolsExpected: false,
    description: 'Discovery / matching feed insights',
  },
  dashboard_summary: {
    capability: 'text',
    preferredChain: ['google/gemma-4-31b-it:free', ...FAST_FREE_CHAIN],
    maxTokens: 800, temperature: 0.3, toolsExpected: false,
    description: 'Dashboard summary blurbs (jobseeker / recruiter)',
  },
};

export function getUseCaseSpec(useCase: AIUseCase): UseCaseSpec {
  const spec = AI_USE_CASES[useCase];
  if (!spec) throw new Error(`Unknown AI use case: ${useCase}`);
  return spec;
}

/** True if the string is a registered use case (for validating untrusted input). */
export function isAIUseCase(s: string): s is AIUseCase {
  return Object.prototype.hasOwnProperty.call(AI_USE_CASES, s);
}
