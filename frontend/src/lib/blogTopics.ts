/**
 * Blog topics — the category vocabulary the /blog index filters by.
 *
 * The blog carries 125+ articles across two corpora (the platform's own writing
 * and the ported hired.video careers/recruiting library), and the only structure
 * they ever had was the free-form `tags:` line in each Markdown front-matter —
 * some 350 distinct values, 200 of which appear exactly once. That is a fine
 * index for "related articles" and a useless one for a filter bar: nobody browses
 * by `payroll-iron-gray`.
 *
 * So topics are a REGISTRY, in the same shape the marketplace families use
 * (`lib/marketplaceFamilies.ts`): a small ordered list of groups, each declaring
 * the anchor tags that file an article under it. A post belongs to the FIRST
 * topic sharing any of its tags, so the order below is the precedence order —
 * the narrower groups come before the broader ones. Anything unmatched lands in
 * `more`, which keeps a new article findable on the day it is written rather
 * than dropping it out of the bar until somebody remembers to map its tag.
 *
 * The sub-filter chips are NOT declared here. They are derived from the posts a
 * topic actually holds (`topTagsFor`), so a tag that no longer has an article
 * cannot linger as a chip that selects nothing — the same reason the marketplace
 * reads its kinds from the listing registry instead of restating them.
 */

import type { BlogPost } from './blogData';

export interface BlogTopic {
  id: string;
  /** i18n key under `blog.topic`. */
  labelKey: string;
  /** Tags that file an article under this topic. First match wins. */
  tags: readonly string[];
}

/**
 * The topics, in precedence order.
 *
 * Order is the whole design. `compare` leads because a head-to-head is what a
 * reader came for even when it is also about agents; the two hiring/careers
 * groups come before the platform ones so that a recruiting article tagged
 * `agents` files under Hiring rather than disappearing into a technical topic;
 * `more` trails as the catch-all and declares no tags — it is what a post falls
 * into, never what it matches.
 *
 * Two tags are deliberately absent from every list: `workforce` and `video`.
 * Both are written in two different senses across the corpus (an agentic
 * workforce and a people-ops one; a video meeting and a video résumé), so
 * anchoring on either drags unrelated articles into the wrong topic. Their
 * unambiguous siblings — `agentic-workforce`, `video-resume` — carry the meaning.
 */
export const BLOG_TOPICS: readonly BlogTopic[] = [
  {
    id: 'compare',
    labelKey: 'compare',
    tags: [
      'comparison', 'copilot', 'cursor', 'windsurf', 'devin', 'claude-code',
      'ai-coding-tools', 'builderforce-vs-linkedin', 'linkedin-recruiter-vs',
      'indeed-vs', 'indeed-pricing', 'glassdoor-vs', 'zipintro-alternative',
    ],
  },
  {
    id: 'hiring',
    labelKey: 'hiring',
    tags: [
      'hiring', 'recruiting', 'recruiting-ops', 'for-recruiters', 'structured-hiring',
      'scorecards', 'interview-rubric', 'video-screening', 'live-screening',
      'live-video-screening', 'semantic-sourcing', 'recruiter-agent',
      'ai-recruiter-agent', 'candidate-profile', 'candidate-packet',
      'anonymize-resume', 'talent-profile', 'talent-event', 'hiring-workspace',
      'hiring-meetup', 'retained-search', 'warm-intro-hiring', 'work-sample-test',
      'fair-take-home', 'assignments', 'ai-matching', 'ai-job-matching',
      'skill-matching', 'job-fit-score', 'job-resume-match', 'employee-reviews',
      'company-reviews', 'company-culture-review', 'write-employer-review',
      'honest-employer-review', 'employer-research', 'references', 'job-references',
      'verified-references', 'reference-letter', 'reference-list', 'reference-page',
      'share-references',
    ],
  },
  {
    id: 'careers',
    labelKey: 'careers',
    tags: [
      'resume', 'ats', 'job-search', 'career-strategy', 'career-growth',
      'career-roadmap', 'career-goals', 'career-360', 'ai-career-planner',
      'video-resume', 'video-cv', 'video-resume-tips', 'studio',
      'salary-research', 'salary-negotiation', 'salary-calculator',
      'salary-by-city', 'market-rate-salary', 'interview', 'interview-prep',
      'mock-interview', 'ai-interview', 'interview-pitch', 'elevator-pitch',
      'star-method', 'headline-writing', 'personal-brand-statement',
      'value-proposition', 'linkedin-summary', 'profile-sync', 'skills',
      'skill-extractor', 'skills-gap-analysis', 'upskilling', 'should-i-apply',
    ],
  },
  {
    // Running and selling the company, which is a different reader from the one
    // browsing Delivery: a founder asking how the money, the ownership and the
    // paperwork work, not a delivery lead asking how the work is governed.
    //
    // It sits after the two people topics so a recruiting article keeps its
    // home, and before `canvas` so an article about SELLING that happens to
    // mention the board files under what it is about. `sales` and `marketplace`
    // are deliberately absent: both are carried by articles that already have a
    // correct home one topic down, and an anchor tag that steals is worse than
    // a topic that is one article smaller.
    id: 'business',
    labelKey: 'business',
    tags: [
      'founder-ops', 'finance', 'invoicing', 'cap-table', 'equity', 'legal',
      'crm', 'quotes', 'mutual-action-plan', 'escrow', 'milestones', 'contracts',
      'freelance', 'hrms',
    ],
  },
  {
    id: 'canvas',
    labelKey: 'canvas',
    tags: [
      'creation-canvas', 'creative-canvas', 'diagrams', 'drawio', 'mermaid',
      'excalidraw', 'visio', 'lucidchart', 'miro', 'bpmn', 'uml', 'mockups',
      'prototyping', 'presentations', 'templates', 'marketplace-templates',
      'versioning', 'brainstorm', 'customer-feedback', 'product-design',
    ],
  },
  {
    id: 'learning',
    labelKey: 'learning',
    tags: [
      'learning', 'learning-path', 'learning-certificate', 'courses', 'lms',
      'scorm', 'scorm-course', 'upload-scorm', 'xapi', 'xapi-lrs', 'classrooms',
      'run-a-cohort', 'sell-a-course', 'educator-tools', 'intern-education-first',
      'prove-certification', 'hmac-certificate', 'tutorial', 'how-to',
      'getting-started', 'introduction', 'overview', 'best-practices',
    ],
  },
  {
    id: 'teamwork',
    labelKey: 'teamwork',
    tags: [
      'collaboration', 'realtime-collaboration', 'real-time', 'meetings',
      'standups', 'ceremonies', 'team-chat', 'teamwork', 'team-activities',
      'webrtc', 'mesh', 'calendar', 'events', 'event-rsvp', 'create-an-event',
      'one-on-ones', '1-1-template', '1-1-action-items', 'people-ops', 'people',
      'people-analytics', 'management', 'leadership', 'team-health', 'team-morale',
      'sentiment-analysis', 'roles', 'onboarding', 'coaching', 'career-coaching',
      'career-coach-booking', 'bookings', 'company-org-chart', 'headcount-roster',
      'companies',
    ],
  },
  {
    id: 'methodology',
    labelKey: 'methodology',
    tags: [
      'methodology', 'idea-to-real', 'validation', 'proof-of-concept',
      'product-strategy', 'product-ideation', 'product-management', 'strategy',
      'vision', 'navigation', 'product-updates', 'platform', 'builderforce',
    ],
  },
  {
    id: 'evermind',
    labelKey: 'evermind',
    tags: [
      'evermind', 'ssm', 'mamba', 'llm', 'memory', 'write-through-cognition',
      'webgpu', 'lora', 'local-first', 'on-device', 'fine-tuning', 'model-training',
      'training', 'semantic-cache', 'tokens', 'rag', 'mcp', 'dataset',
      'voice-cloning', 'evaluation', 'ai-voiceover', 'ai-voiceover-podcast',
      'free-ai-narration',
    ],
  },
  {
    id: 'agents',
    labelKey: 'agents',
    tags: [
      'agents', 'ai-agents', 'agentic', 'agentic-workforce', 'agentic-employee',
      'agentic-tester', 'agent-stack', 'agent-spec', 'multi-agent', 'orchestration',
      'fleet', 'routing', 'roster', 'personas', 'personality', 'psychometric',
      'autonomous', 'autonomous-agents', 'swimlanes', 'approval-gates',
      'human-in-the-loop', 'brain', 'capabilities',
    ],
  },
  {
    id: 'devtools',
    labelKey: 'devtools',
    tags: [
      'developer-tools', 'developers', 'vscode', 'vs-code', 'ide', 'monaco',
      'webcontainers', 'browser', 'extensions', 'plugins', 'api', 'debugging',
      'ai-coding', 'ai-native-development', 'ai-planning', 'architecture',
      'deep-dive', 'workflows', 'data', 'marketplace',
    ],
  },
  {
    id: 'delivery',
    labelKey: 'delivery',
    tags: [
      'governance', 'compliance', 'audit', 'security', 'privacy', 'multi-tenant',
      'rbac', 'authentication', 'pmo', 'planning', 'executive-planning', 'specs',
      'prd', 'kanban', 'tasks', 'assign-tasks', 'track-work', 'roadmaps',
      'portfolio', 'portfolio-management', 'project-management', 'delivery',
      'execution', 'observability', 'monitoring', 'telemetry', 'errors',
      'one-click-fix', 'quality', 'qa', 'testing', 'playwright', 'reliability',
      'incidents', 'incident', 'on-call', 'itsm', 'dora', 'enterprise',
      'system-of-record', 'accountability', 'knowledge-management', 'sops',
      'finops', 'cost', 'cost-optimization', 'capex-opex', 'cobit', 'risk',
      'diagnostics', 'maturity', 'integrations', 'integration', 'interoperability',
      'connectors', 'board-sync', 'vendor-sync', 'migration', 'jira', 'monday',
      'rally', 'gitlab', 'bitbucket', 'github', 'single-pane', 'analytics',
      'dashboards', 'timeline', 'compile-primitive', 'rfp', 'proposals',
      'pre-sales', 'performance',
    ],
  },
  // The catch-all. It declares no tags on purpose — a post FALLS INTO it, and
  // nothing matches it, so it can never shadow a real topic above.
  { id: 'more', labelKey: 'more', tags: [] },
];

export const BLOG_TOPIC_IDS: readonly string[] = BLOG_TOPICS.map((t) => t.id);

/** Every topic id → its tag set, built once rather than scanned per post. */
const TAG_INDEX: ReadonlyArray<{ id: string; tags: ReadonlySet<string> }> = BLOG_TOPICS.map((t) => ({
  id: t.id,
  tags: new Set(t.tags),
}));

/** The catch-all every unmatched post files under. */
export const FALLBACK_TOPIC = 'more';

/** The topic an article belongs to — the first one sharing any of its tags. */
export function topicOf(post: BlogPost): string {
  for (const topic of TAG_INDEX) {
    if (post.tags.some((tag) => topic.tags.has(tag))) return topic.id;
  }
  return FALLBACK_TOPIC;
}

export function isBlogTopic(value: string): boolean {
  return BLOG_TOPIC_IDS.includes(value);
}

/** How many articles each topic holds. Topics with none are omitted. */
export function topicCounts(posts: readonly BlogPost[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const post of posts) {
    const id = topicOf(post);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * The sub-filter chips for a set of posts: their most common tags, most-used
 * first, then alphabetically so the order is stable between renders.
 *
 * Derived rather than declared — a chip exists exactly while an article carries
 * the tag, so the bar can never offer a filter that selects nothing.
 */
export function topTagsFor(posts: readonly BlogPost[], limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

/**
 * Full-text match over the fields a reader can see — title, description, tags
 * and author. ONE matcher, so the card grid, the list rows and the result count
 * can never disagree about what the search box selected.
 */
export function matchesQuery(post: BlogPost, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Every whitespace-separated term must appear somewhere — "canvas diagram"
  // narrows rather than widening, which is what a reader typing two words means.
  const haystack = `${post.title} ${post.description} ${post.author} ${post.tags.join(' ')}`.toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/** Apply topic + tag + query in one place, so every surface filters identically. */
export function filterPosts(
  posts: readonly BlogPost[],
  { topic, tag, query }: { topic?: string; tag?: string; query?: string },
): BlogPost[] {
  return posts.filter(
    (post) =>
      (!topic || topicOf(post) === topic) &&
      (!tag || post.tags.includes(tag)) &&
      matchesQuery(post, query ?? ''),
  );
}
