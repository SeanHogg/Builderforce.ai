/**
 * Search-facing STRUCTURE: the concept glossary's ids, the curated integration
 * leaf pages, and which blog posts back which surface.
 *
 * The words — every defined term and every integration page — are catalog copy
 * under `marketing.content.{definedTerms,integrations}`, resolved through the
 * reader a page already holds, so the JSON-LD a crawler receives is in the
 * language the page is.
 */
import { contentKey, rawList, type CopyReader } from './copy';

/* ════════════════════ DEFINED TERMS (GEO) ════════════════════ */

/** Every concept in the glossary, in emission order — `marketing.content.definedTerms.<id>`. */
export const DEFINED_TERM_IDS = [
  'evermind',
  'writeThroughCognition',
  'webgpuLora',
  'workforceRegistry',
  'evaluationEngine',
  'instructionDataset',
  'agentOrchestration',
  'multiAgentOrchestration',
  'humanInLoopGovernance',
  'agentInAgent',
  'agentKanban',
  'autonomousSwimlane',
  'semanticCache',
  'systemOfRecord',
  'aiFinops',
  'innovationFunnel',
  'roleLens',
  'planningSpine',
  'errorObservability',
  'knowledgeCompliance',
  'maturityIndex',
  'teacherDistillation',
  'projectEvermind',
  'workforceKanban',
  'validatorAgent',
  'learnedRouting',
  'memoryFirst',
  'roleGatedAccountability',
  'incidentRca',
  'rfpResponse',
] as const;

export type DefinedTermId = (typeof DEFINED_TERM_IDS)[number];

export interface DefinedTermEntry {
  name: string;
  description: string;
}

/** The glossary (or a subset of it), localized by the reader. */
export function definedTerms(t: CopyReader, ids: readonly DefinedTermId[] = DEFINED_TERM_IDS): DefinedTermEntry[] {
  return ids.map((id) => ({
    name: t(contentKey(`definedTerms.${id}.name`)),
    description: t(contentKey(`definedTerms.${id}.description`)),
  }));
}

/* ════════════════════ PROGRAMMATIC SEO — INTEGRATION LEAF PAGES ════════════════════ */

/**
 * The bounded set of `/integrations/{slug}` leaf pages that capture
 * "Builderforce + {tool}" search intent. Keep it curated (no thin auto-generated
 * bloat): each entry's category, tagline, summary and use cases are written
 * copy at `marketing.content.integrations.<slug>`. `name` is the vendor's
 * proper noun and is also the key `/integrations` matches registry entries on.
 */
export interface IntegrationSeo {
  slug: string;
  name: string;
  /** Optional deep link into docs/skills for the "Learn more" CTA. */
  docsHref?: string;
}

export const SEO_INTEGRATIONS: IntegrationSeo[] = [
  { slug: 'github', name: 'GitHub', docsHref: '/agents/integrations' },
  { slug: 'gitlab', name: 'GitLab', docsHref: '/agents/integrations' },
  { slug: 'slack', name: 'Slack', docsHref: '/agents/integrations' },
  { slug: 'discord', name: 'Discord', docsHref: '/agents/integrations' },
  { slug: 'whatsapp', name: 'WhatsApp', docsHref: '/agents/integrations' },
  { slug: 'ollama', name: 'Ollama', docsHref: '/agents/integrations' },
  { slug: 'anthropic', name: 'Anthropic Claude', docsHref: '/agents/integrations' },
  { slug: 'mcp', name: 'Model Context Protocol (MCP)', docsHref: '/agents/integrations' },
  { slug: 'notion', name: 'Notion', docsHref: '/agents/integrations' },
  { slug: 'gmail', name: 'Gmail', docsHref: '/agents/integrations' },
];

/** Slug -> integration record, for `/integrations/{slug}` route resolution. */
export const INTEGRATION_SLUG_MAP: Record<string, IntegrationSeo> = Object.fromEntries(
  SEO_INTEGRATIONS.map((it) => [it.slug, it]),
);

/** A leaf page's written copy, localized. */
export interface IntegrationCopy {
  category: string;
  tagline: string;
  summary: string;
  useCases: string[];
}

/** Catalog key of one field of an integration leaf page. */
export function integrationKey(slug: string, field: keyof IntegrationCopy): string {
  return contentKey(`integrations.${slug}.${field}`);
}

export function integrationCopy(t: CopyReader, slug: string): IntegrationCopy {
  return {
    category: t(integrationKey(slug, 'category')),
    tagline: t(integrationKey(slug, 'tagline')),
    summary: t(integrationKey(slug, 'summary')),
    useCases: rawList<string>(t, integrationKey(slug, 'useCases')),
  };
}

/* ════════════════════ RELATED ARTICLES (associated blog content per surface) ════════════════════ */

/**
 * Single source of truth mapping a marketing surface to the blog posts that
 * back it as "associated content". Keys are stable surface ids (the page path
 * minus its leading slash, or a `compare:<competitorKey>` key for the per-rival
 * leaf pages). Values are ordered blog slugs resolved against `BLOG_POSTS`.
 *
 * The reusable <RelatedArticles> component reads this via `getPostsBySlugs`, so
 * adding a post to a page is a one-line data edit — no per-page JSX. Keep slugs
 * in sync with src/content/blog/*.md (a missing slug is silently skipped).
 */
export const RELATED_ARTICLES: Record<string, string[]> = {
  'creation-canvas': [
    'walk-me-through-what-you-made',
    'send-the-link-join-without-an-account',
    'run-your-app-on-the-canvas',
    'the-canvas-gave-the-screen-back-to-the-board',
    'build-a-3d-world-in-the-browser',
    'read-any-pdf-even-the-scanned-ones',
    'creation-canvas-beyond-chat',
    'every-diagram-format-the-canvas-reads',
    'which-diagram-should-you-draw',
    'escape-your-diagramming-tool',
    'compare-projects-and-build-an-executive-roadmap',
    'customer-feedback-to-ten-mockups',
    'build-and-train-evermind-on-the-creation-canvas',
    'multiplayer-creation-canvas-web-vscode',
    // The Creator Studio guides, ported with the hired.video corpus — the
    // Canvas is the surface those articles now describe.
    'how-to-make-a-video-resume-in-hired-video-studio',
    'how-to-make-a-podcast-episode-in-hired-video-studio',
    'how-to-make-an-animated-comic-resume-in-hired-video-studio',
    'how-to-build-a-3d-world-resume-in-hired-video-studio',
  ],
  product: [
    'send-the-link-join-without-an-account',
    'grade-the-proof-and-close-the-loop',
    'idea-to-real-the-operating-methodology',
    'run-your-app-on-the-canvas',
    'close-the-deal-on-the-board-you-built-it-on',
    'eight-ways-to-make-an-idea-real',
    'creation-canvas-beyond-chat',
    'customer-feedback-to-ten-mockups',
    'multiplayer-creation-canvas-web-vscode',
    'compare-projects-and-build-an-executive-roadmap',
    'build-and-train-evermind-on-the-creation-canvas',
    'transitioning-to-an-agentic-workforce',
    'real-time-collaboration-humans-and-agents',
    'define-a-need-the-agentic-system-solves-it',
    'agent-tech-stack-all-seven-layers',
    'evermind-self-updating-model',
    'system-of-record-for-agentic-work',
    'planning-spine-cost-bearing-delivery',
    'quality-error-observability-one-click-fix',
    'incident-management-on-call-and-war-rooms',
    'role-gated-accountability-proof-of-participation',
    'automated-rfp-response-from-your-codebase',
    'memory-first-inference-skip-the-llm',
  ],
  // Evermind technology page / feature teaser.
  evermind: [
    'four-questions-before-you-buy-enterprise-ai',
    'build-and-train-evermind-on-the-creation-canvas',
    'evermind-self-updating-model',
    'inside-evermind-architecture',
    'memory-first-inference-skip-the-llm',
    'local-first-ai-webgpu-in-the-browser',
    'transitioning-to-an-agentic-workforce',
    'agent-tech-stack-all-seven-layers',
    'semantic-response-cache',
  ],
  compare: [
    'best-ai-coding-agents-compared',
    'builderforce-vs-github-copilot',
    'builderforce-vs-cursor-windsurf',
  ],
  pricing: [
    // The method leads, because the pricing question a visitor actually has is
    // "what am I paying for" and the answer is the third act, not the first two.
    'read-prove-build-the-inner-loop',
    'grade-the-proof-and-close-the-loop',
    'eight-ways-to-make-an-idea-real',
    'evermind-self-updating-model',
    'memory-first-inference-skip-the-llm',
    'system-of-record-for-agentic-work',
    'semantic-response-cache',
  ],
  /**
   * The methodology set. Attached to every surface that renders
   * <MethodologySection>, so a visitor who wants the long version has one
   * consistent set of articles behind the same pages.
   */
  methodology: [
    'idea-to-real-the-operating-methodology',
    'eight-ways-to-make-an-idea-real',
    'read-prove-build-the-inner-loop',
    'idea-make-run-measure-menu-as-methodology',
    // The fifth: where the loop CLOSES. The other four describe the method; this
    // one describes what happens to the number it told you to write down.
    'grade-the-proof-and-close-the-loop',
  ],
  // Per-competitor leaf pages — keyed by the competitor column key. Each points
  // at its dedicated head-to-head post first, then the roundup for context.
  'compare:copilot': ['builderforce-vs-github-copilot', 'best-ai-coding-agents-compared'],
  'compare:cursor': ['builderforce-vs-cursor-windsurf', 'best-ai-coding-agents-compared'],
  'compare:claudeCode': ['builderforce-vs-claude-code', 'best-ai-coding-agents-compared'],
  'compare:devin': ['builderforce-vs-devin', 'best-ai-coding-agents-compared'],

  // Feature routes — associated blog content shown on each logged-out feature
  // teaser (RouteMarketing). Keyed by the route path minus its leading slash.
  brainstorm: ['product-ideation-with-builderforce', 'specs-and-planning-with-ai', 'getting-started-with-ai-agents'],
  ide: ['vs-code-command-center-for-your-agentic-workforce', 'in-browser-ide-and-collaboration', 'product-ideation-with-builderforce'],
  training: ['webgpu-lora-explained', 'local-first-ai-webgpu-in-the-browser', 'inside-evermind-architecture', 'evermind-self-updating-model', 'ai-dataset-generation-best-practices', 'how-to-launch-a-course-and-upload-scorm-on-hired-video', 'how-to-run-a-classroom-cohort-as-an-educator', 'how-to-earn-a-verifiable-certificate-on-hired-video'],
  workflows: ['define-a-need-the-agentic-system-solves-it', 'multi-agent-orchestration', 'autonomous-swimlane-execution'],
  projects: ['planning-spine-cost-bearing-delivery', 'role-gated-accountability-proof-of-participation', 'autonomous-swimlane-execution', 'task-execution-and-observability'],
  workforce: ['real-time-collaboration-humans-and-agents', 'multi-party-team-chat-humans-and-agents', 'fleet-management-and-agent-routing', 'how-to-run-effective-one-on-ones', 'how-to-build-an-org-chart-that-stays-accurate', 'team-health-signals-every-manager-should-watch'],
  meetings: ['video-meetings-standups-and-shared-calendars', 'real-time-collaboration-humans-and-agents', 'multi-party-team-chat-humans-and-agents', 'how-to-host-a-hiring-event-on-hired-video', 'how-to-book-a-coaching-session-on-hired-video'],
  skills: ['skills-assignment-and-the-marketplace', 'builderforce-agents-and-agent-integration', 'best-ai-coding-agents-compared'],
  personas: ['ai-agent-personality-psychometric-personas', 'builderforce-agents-and-agent-integration', 'multi-agent-orchestration'],
  'content-manager': ['skills-assignment-and-the-marketplace', 'product-ideation-with-builderforce'],
  security: ['every-role-operating-picture', 'role-gated-accountability-proof-of-participation', 'security-and-multi-tenant-architecture', 'cobit-governance-readiness-for-agentic-it'],
  soc2: ['cobit-governance-readiness-for-agentic-it', 'security-and-multi-tenant-architecture', 'knowledge-management-sops-and-compliance'],
  contributors: ['every-role-operating-picture', 'task-execution-and-observability', 'multi-agent-orchestration'],
  dashboard: ['system-of-record-for-agentic-work', 'real-time-collaboration-humans-and-agents', 'every-role-operating-picture'],
  agents: ['builderforce-agents-and-agent-integration', 'fleet-management-and-agent-routing', 'single-pane-board-connectors'],
  prompts: ['specs-and-planning-with-ai', 'product-ideation-with-builderforce', 'getting-started-with-ai-agents'],
  diagnostics: ['ai-development-maturity-diagnostic', 'cobit-governance-readiness-for-agentic-it', 'system-of-record-for-agentic-work'],
  // Newer enterprise surfaces.
  knowledge: ['knowledge-management-sops-and-compliance', 'every-role-operating-picture', 'security-and-multi-tenant-architecture'],
  quality: ['quality-error-observability-one-click-fix', 'incident-management-on-call-and-war-rooms', 'agentic-tester-autonomous-qa', 'task-execution-and-observability'],
  // The salary guide — the four ported posts that send readers to a pay page.
  salary: [
    'fifteen-free-career-tools-and-a-salary-guide',
    'how-to-research-your-market-salary',
    'research-employers-with-reviews-and-salary-data',
    'hired-video-vs-glassdoor-reviews-salary-employer-branding',
    'how-to-write-your-personal-value-proposition',
  ],
};
