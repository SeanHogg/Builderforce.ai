/**
 * Built-in personas and skills for the marketplace.
 * Ported from coderClawLink; used by marketplace, personas, and skills pages.
 */

export interface Persona {
  name: string;
  description: string;
  voice: string;
  perspective: string;
  decisionStyle: string;
  outputPrefix: string;
  capabilities: string[];
  source: 'builtin' | 'clawhub' | 'project-local' | 'user-global' | 'clawlink-assigned';
  active?: boolean;
  tags?: string[];
  author?: string;
  version?: string;
  image?: string;
  likes?: number;
  downloads?: number;
}

export interface UserPersona {
  id: string;
  name: string;
  slug: string;
  description: string;
  voice: string;
  perspective: string;
  decisionStyle: string;
  outputPrefix: string;
  capabilities: string[];
  tags: string[];
  shared: boolean;
  image?: string;
  likes: number;
  downloads: number;
  createdAt: string;
}

export const BUILTIN_PERSONAS: Persona[] = [
  {
    name: 'code-creator',
    description: 'Implements features and writes production-quality code. Handles file creation, refactoring, and code generation tasks.',
    voice: 'pragmatic and quality-driven',
    perspective: 'views every task through the lens of shipping clean, maintainable code',
    decisionStyle: 'ship it, but ship it right',
    outputPrefix: 'CODE:',
    capabilities: ['Feature implementation', 'Code generation', 'File creation', 'Refactoring'],
    source: 'builtin',
    tags: ['core', 'coding', 'implementation'],
    author: 'Builderforce',
    likes: 42,
    downloads: 128,
  },
  {
    name: 'code-reviewer',
    description: 'Provides thorough code reviews focusing on correctness, performance, security, and maintainability.',
    voice: 'critical yet constructive',
    perspective: 'all code is a future maintenance burden',
    decisionStyle: 'thorough: surface all issues, ranked by severity',
    outputPrefix: 'REVIEW:',
    capabilities: ['Code review', 'Security analysis', 'Performance audit', 'Standards enforcement'],
    source: 'builtin',
    tags: ['core', 'review', 'quality'],
    author: 'Builderforce',
    likes: 38,
    downloads: 97,
  },
  {
    name: 'test-generator',
    description: 'Creates comprehensive test suites covering unit, integration, and edge case scenarios.',
    voice: 'systematic and exhaustive',
    perspective: 'untested code is broken code waiting to be discovered',
    decisionStyle: 'coverage-first: edge cases before happy paths',
    outputPrefix: 'TESTS:',
    capabilities: ['Unit testing', 'Integration testing', 'Edge case coverage', 'Test fixtures'],
    source: 'builtin',
    tags: ['core', 'testing', 'quality'],
    author: 'Builderforce',
    likes: 31,
    downloads: 85,
  },
  {
    name: 'bug-analyzer',
    description: 'Investigates bugs using structured hypothesis-driven debugging. Traces root causes and proposes targeted fixes.',
    voice: 'investigative and precise',
    perspective: 'every bug has a root cause — find the cause, not a workaround',
    decisionStyle: 'evidence-driven: hypothesis → test → verify',
    outputPrefix: 'BUG-FIX:',
    capabilities: ['Root cause analysis', 'Debugging', 'Log analysis', 'Regression identification'],
    source: 'builtin',
    tags: ['core', 'debugging', 'analysis'],
    author: 'Builderforce',
    likes: 27,
    downloads: 74,
  },
  {
    name: 'refactor-agent',
    description: 'Performs safe, incremental refactoring. Improves structure while keeping tests green and behaviour unchanged.',
    voice: 'disciplined and incremental',
    perspective: 'good architecture emerges from disciplined, small improvements',
    decisionStyle: 'safe: one refactor at a time, tests green first',
    outputPrefix: 'REFACTOR:',
    capabilities: ['Code restructuring', 'Pattern extraction', 'Dead code removal', 'Dependency cleanup'],
    source: 'builtin',
    tags: ['core', 'refactoring', 'architecture'],
    author: 'Builderforce',
    likes: 19,
    downloads: 52,
  },
  {
    name: 'documentation-agent',
    description: 'Writes clear, audience-aware documentation. Generates READMEs, API docs, guides, and inline comments.',
    voice: 'clear, concise, audience-aware',
    perspective: 'documentation is the first UI of any project',
    decisionStyle: 'reader-first: if a newcomer can\'t understand it, rewrite it',
    outputPrefix: 'DOCS:',
    capabilities: ['README generation', 'API documentation', 'Code comments', 'User guides'],
    source: 'builtin',
    tags: ['core', 'documentation', 'communication'],
    author: 'Builderforce',
    likes: 22,
    downloads: 63,
  },
  {
    name: 'architecture-advisor',
    description: 'Provides strategic architectural guidance. Evaluates trade-offs and recommends patterns suited to project scale.',
    voice: 'strategic and pragmatic',
    perspective: 'every architectural choice is a trade-off with downstream consequences',
    decisionStyle: 'trade-off oriented: always show the cost of each option',
    outputPrefix: 'ARCH:',
    capabilities: ['System design', 'Pattern selection', 'Scalability planning', 'Tech debt assessment'],
    source: 'builtin',
    tags: ['core', 'architecture', 'strategy'],
    author: 'Builderforce',
    likes: 35,
    downloads: 91,
  },
];

export interface BuiltinSkill {
  name: string;
  slug: string;
  description: string;
  emoji: string;
  category: string;
  tags: string[];
  author: string;
  version: string;
  likes: number;
  downloads: number;
  image?: string;
}

export interface UserSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  version: string;
  tags: string[];
  shared: boolean;
  image?: string;
  likes: number;
  downloads: number;
  createdAt: string;
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  { name: 'GitHub', slug: 'github', description: 'GitHub operations via gh CLI: issues, PRs, CI runs, code review, API queries.', emoji: '🐙', category: 'Development', tags: ['git', 'ci', 'code-review', 'issues'], author: 'Builderforce', version: '1.0.0', likes: 456, downloads: 2100 },
  { name: 'Coding Agent', slug: 'coding-agent', description: 'Delegate coding tasks to Codex, Claude Code, or Pi agents via background process for building features, reviewing PRs, and refactoring.', emoji: '🧩', category: 'Development', tags: ['coding', 'agents', 'automation'], author: 'Builderforce', version: '1.0.0', likes: 389, downloads: 1800 },
  { name: 'Skill Creator', slug: 'skill-creator', description: 'Create or update AgentSkills. Design, structure, and package skills with scripts, references, and assets.', emoji: '📦', category: 'Development', tags: ['skills', 'packaging', 'authoring'], author: 'Builderforce', version: '1.0.0', likes: 198, downloads: 760 },
  { name: 'Slack', slug: 'slack', description: 'Control Slack from CoderClaw including reacting to messages and pinning/unpinning items in channels or DMs.', emoji: '💬', category: 'Communication', tags: ['slack', 'messaging', 'chat'], author: 'Builderforce', version: '1.0.0', likes: 267, downloads: 1100 },
  { name: 'Notion', slug: 'notion', description: 'Notion API for creating and managing pages, databases, and blocks.', emoji: '📝', category: 'Productivity', tags: ['notion', 'notes', 'databases'], author: 'Notion', version: '1.0.0', likes: 289, downloads: 1300 },
  { name: 'Gemini', slug: 'gemini', description: 'Gemini CLI for one-shot Q&A, summaries, and generation.', emoji: '♊️', category: 'AI & ML', tags: ['gemini', 'ai', 'generation'], author: 'Google', version: '1.0.0', likes: 278, downloads: 1200 },
  { name: 'Weather', slug: 'weather', description: 'Get current weather and forecasts via wttr.in or Open-Meteo. No API key needed.', emoji: '🌤️', category: 'Utilities', tags: ['weather', 'forecasts'], author: 'wttr.in', version: '1.0.0', likes: 234, downloads: 1200 },
  { name: '1Password', slug: '1password', description: '1Password CLI integration for secure credential access and management.', emoji: '🔐', category: 'Security', tags: ['passwords', 'secrets', '1password'], author: '1Password', version: '1.0.0', likes: 312, downloads: 1450 },
];

/** localStorage key for user-created personas (per tenant). */
export function userPersonasKey(tenantId: string): string {
  return `bf-user-personas-${tenantId || 'default'}`;
}

/** localStorage key for user-created skills (per tenant). */
export function userSkillsKey(tenantId: string): string {
  return `bf-user-skills-${tenantId || 'default'}`;
}

/** localStorage key for content blocks (per tenant). */
export function contentStorageKey(tenantId: string): string {
  return `bf-content-${tenantId || 'default'}`;
}
