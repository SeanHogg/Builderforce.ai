/**
 * The career domain's shared vocabulary — tokenizer, stop-words, skill lexicon and
 * verb classes.
 *
 * ── WHY THIS IS ONE MODULE ───────────────────────────────────────────────────────
 * Six different answers in this domain are the same measurement wearing different
 * labels: "score my résumé", "does this résumé match this job", "what skills does this
 * posting want", "what am I missing for that target role", "screen this candidate", and
 * "what should I say in my value proposition" all reduce to *tokenize two texts, decide
 * which tokens are meaningful, and compare the sets*. Written per-tool that logic drifts
 * — the scorer counts "React.js" and the matcher counts "reactjs" — and two tools then
 * disagree about the same résumé in the same turn, which is worse than either being
 * wrong alone.
 *
 * So the normalisation rule lives here once and every reader of this domain shares it.
 *
 * ── PURITY IS THE POINT ──────────────────────────────────────────────────────────
 * Nothing in `application/career/*` touches the database, the network, the clock or the
 * Worker env. That is not tidiness: it is what lets the SAME functions serve the
 * tenant-scoped MCP tools AND the anonymous guest surface. A logged-out visitor pasting
 * their résumé into the public canvas gets the identical scoring a paying tenant gets,
 * because there is only one implementation and it needs nothing a guest cannot have.
 */

/** Words that carry no signal when comparing a résumé to a posting. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'for', 'from', 'had', 'has', 'have',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'that', 'the', 'their', 'them', 'they', 'this',
  'to', 'was', 'we', 'were', 'will', 'with', 'you', 'your', 'about', 'across', 'after', 'all', 'also', 'any',
  'because', 'both', 'each', 'more', 'most', 'other', 'over', 'some', 'such', 'than', 'then', 'these', 'those',
  'through', 'under', 'up', 'very', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'would',
  // Posting boilerplate that appears in almost every job description and therefore
  // separates nothing. Leaving these in makes every résumé look like a 40% match.
  'ability', 'candidate', 'experience', 'excellent', 'including', 'job', 'role', 'strong', 'work', 'working',
  'years', 'year', 'team', 'teams', 'plus', 'preferred', 'required', 'requirements', 'responsibilities',
  'skills', 'position', 'opportunity', 'company', 'please', 'apply', 'applicants', 'benefits', 'salary',
]);

/**
 * Multi-word technical and professional terms that must survive tokenisation as ONE
 * token. Without this, "machine learning" scores as two generic words and a posting
 * asking for it matches a résumé that says "learning" in a training bullet.
 *
 * Keyed by the normalised phrase; the value is the canonical display form.
 */
const PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['machine learning', 'Machine Learning'], ['deep learning', 'Deep Learning'],
  ['data science', 'Data Science'], ['data engineering', 'Data Engineering'],
  ['product management', 'Product Management'], ['project management', 'Project Management'],
  ['change management', 'Change Management'], ['stakeholder management', 'Stakeholder Management'],
  ['customer success', 'Customer Success'], ['business development', 'Business Development'],
  ['account management', 'Account Management'], ['supply chain', 'Supply Chain'],
  ['user research', 'User Research'], ['user experience', 'User Experience'],
  ['quality assurance', 'Quality Assurance'], ['continuous integration', 'Continuous Integration'],
  ['unit testing', 'Unit Testing'], ['test automation', 'Test Automation'],
  ['public speaking', 'Public Speaking'], ['financial modelling', 'Financial Modelling'],
  ['financial modeling', 'Financial Modelling'], ['revenue operations', 'Revenue Operations'],
  ['people management', 'People Management'], ['incident response', 'Incident Response'],
  ['technical writing', 'Technical Writing'], ['content marketing', 'Content Marketing'],
  ['social media', 'Social Media'], ['search engine optimization', 'SEO'],
  ['distributed systems', 'Distributed Systems'], ['micro services', 'Microservices'],
  ['natural language processing', 'NLP'], ['computer vision', 'Computer Vision'],
];

/**
 * Aliases folded to one canonical token. This is the whole reason a résumé that says
 * "React.js" and a posting that says "ReactJS" count as a match.
 */
const ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript', 'node.js': 'nodejs', node: 'nodejs', 'react.js': 'react', reactjs: 'react',
  'vue.js': 'vue', vuejs: 'vue', 'next.js': 'nextjs', ts: 'typescript', py: 'python',
  postgres: 'postgresql', 'postgre sql': 'postgresql', k8s: 'kubernetes', gcp: 'googlecloud',
  'google cloud': 'googlecloud', 'amazon web services': 'aws', 'c#': 'csharp', 'c++': 'cpp',
  'objective-c': 'objectivec', 'ci/cd': 'cicd', 'ci cd': 'cicd', ml: 'machinelearning',
  'machine learning': 'machinelearning', ai: 'artificialintelligence', seo: 'seo',
  qa: 'qualityassurance', 'quality assurance': 'qualityassurance', ux: 'userexperience',
  ui: 'userinterface', pm: 'productmanagement', 'product management': 'productmanagement',
  saas: 'saas', b2b: 'b2b', b2c: 'b2c', crm: 'crm', erp: 'erp', api: 'api', apis: 'api',
  rest: 'rest', restful: 'rest', graphql: 'graphql', sql: 'sql', nosql: 'nosql',
};

/**
 * Terms recognised as SKILLS rather than prose, grouped the way a résumé section is.
 * The grouping is what makes `extract_skills` return something a person can paste into
 * a Skills block instead of a bag of words.
 */
export const SKILL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  Languages: ['javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'sql', 'objectivec', 'dart', 'elixir', 'perl', 'bash'],
  'Frameworks & libraries': ['react', 'nextjs', 'vue', 'angular', 'svelte', 'nodejs', 'django', 'flask', 'fastapi', 'rails', 'spring', 'laravel', 'express', 'dotnet', 'pytorch', 'tensorflow', 'pandas', 'numpy', 'tailwind'],
  'Cloud & infrastructure': ['aws', 'azure', 'googlecloud', 'cloudflare', 'kubernetes', 'docker', 'terraform', 'ansible', 'serverless', 'linux', 'nginx', 'cicd', 'jenkins', 'githubactions'],
  'Data & storage': ['postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'snowflake', 'bigquery', 'databricks', 'kafka', 'spark', 'airflow', 'dbt', 'nosql', 'etl'],
  'Practices & methods': ['agile', 'scrum', 'kanban', 'devops', 'tdd', 'qualityassurance', 'microservices', 'rest', 'graphql', 'api', 'accessibility', 'observability', 'sre', 'incidentresponse'],
  // `machinelearning`, `nlp` and `computervision` are canonical PHRASE tokens — the
  // tokenizer collapses "machine learning" into one of them. They must also be listed
  // here or `isSkillToken` returns false for every one, which silently made machine
  // learning invisible to the scorer, the matcher and the role catalogue alike.
  // Both spellings of the two phrases that do not collapse to their acronym: the
  // tokenizer produces the run-together PHRASE form ("naturallanguageprocessing") while
  // a résumé that writes the acronym produces "nlp". Listing one and not the other is
  // how the same skill counts on one document and not on another.
  'AI & data science': ['machinelearning', 'deeplearning', 'nlp', 'naturallanguageprocessing', 'computervision', 'datascience', 'dataengineering'],
  'Product & design': ['productmanagement', 'userexperience', 'userinterface', 'figma', 'wireframing', 'prototyping', 'userresearch', 'roadmapping', 'analytics', 'experimentation'],
  'Business & commercial': ['saas', 'b2b', 'b2c', 'crm', 'erp', 'salesforce', 'hubspot', 'forecasting', 'budgeting', 'pricing', 'negotiation', 'procurement', 'compliance'],
  'Marketing & growth': ['seo', 'searchengineoptimization', 'contentmarketing', 'socialmedia', 'customersuccess', 'businessdevelopment', 'accountmanagement'],
  'Leadership & communication': ['mentoring', 'coaching', 'hiring', 'stakeholdermanagement', 'facilitation', 'publicspeaking', 'technicalwriting', 'peoplemanagement', 'changemanagement'],
};

/** Flat lookup: canonical token → the group it belongs to. */
const SKILL_INDEX: ReadonlyMap<string, string> = new Map(
  Object.entries(SKILL_GROUPS).flatMap(([group, tokens]) => tokens.map((t) => [t, group] as const)),
);

/**
 * Verbs that make a bullet read as ownership. A bullet that opens with one of these is
 * doing the thing hiring managers actually scan for.
 */
export const STRONG_VERBS: readonly string[] = [
  'led', 'built', 'shipped', 'launched', 'designed', 'architected', 'delivered', 'owned', 'drove', 'grew',
  'reduced', 'increased', 'cut', 'saved', 'scaled', 'automated', 'migrated', 'rebuilt', 'negotiated',
  'closed', 'hired', 'mentored', 'founded', 'created', 'introduced', 'streamlined', 'recovered', 'won',
];

/**
 * Openers that describe presence rather than contribution. These are the single most
 * common reason a competent person's résumé reads as junior.
 */
export const WEAK_OPENERS: readonly string[] = [
  'responsible for', 'worked on', 'helped', 'assisted', 'involved in', 'participated in', 'tasked with',
  'duties included', 'contributed to', 'supported', 'familiar with', 'exposure to',
];

/** Words that carry negative or hedging tone — read by the sentiment tool. */
const NEGATIVE_TONE: readonly string[] = [
  'unfortunately', 'failed', 'unable', 'struggled', 'lacked', 'problem', 'issue', 'difficult', 'limited',
  'only', 'just', 'attempted', 'tried', 'hopefully', 'somewhat', 'basic', 'minimal', 'laid off', 'terminated',
];

/** Words that carry confident, outcome-oriented tone. */
const POSITIVE_TONE: readonly string[] = [
  ...STRONG_VERBS, 'improved', 'exceeded', 'achieved', 'award', 'awarded', 'promoted', 'recognised',
  'recognized', 'successful', 'record', 'best', 'first', 'expert', 'certified', 'accelerated',
];

/** Normalise one raw word: lowercase, strip punctuation, fold aliases. */
export function canonicalize(word: string): string {
  const cleaned = word.toLowerCase().replace(/[^a-z0-9+#.]/g, '');
  if (!cleaned) return '';
  const alias = ALIASES[cleaned] ?? ALIASES[word.toLowerCase()];
  if (alias) return alias;
  // Trailing dots ("node." at a sentence end) are punctuation, not part of the token.
  const trimmed = cleaned.replace(/\.+$/, '');
  return ALIASES[trimmed] ?? trimmed;
}

/**
 * Tokenise a body of text into canonical, meaningful tokens.
 *
 * Multi-word phrases are collapsed FIRST so "machine learning" survives as one token,
 * then the remainder is split on non-word characters, canonicalised, and filtered
 * against the stop list and a two-character floor.
 */
export function tokenize(text: string): string[] {
  let working = ` ${text.toLowerCase()} `;
  const found: string[] = [];
  for (const [phrase] of PHRASES) {
    if (working.includes(phrase)) {
      found.push(canonicalize(phrase.replace(/\s+/g, '')));
      working = working.split(phrase).join(' ');
    }
  }
  for (const raw of working.split(/[^a-z0-9+#.]+/)) {
    const token = canonicalize(raw);
    if (!token || token.length < 2) continue;
    if (STOP_WORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    found.push(token);
  }
  return found;
}

/** Distinct tokens, preserving first-seen order (stable output for the same input). */
export function tokenSet(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokenize(text)) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/** Occurrence counts per canonical token. */
export function tokenCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/** True when a canonical token is a recognised skill (not just any noun). */
export function isSkillToken(token: string): boolean {
  return SKILL_INDEX.has(token);
}

/** The skill group a canonical token belongs to, or null when it is not a known skill. */
export function skillGroupOf(token: string): string | null {
  return SKILL_INDEX.get(token) ?? null;
}

/**
 * Turn a canonical token back into something a person would recognise on a page.
 * `nodejs` → `Node.js`, `machinelearning` → `Machine Learning`.
 */
export function displaySkill(token: string): string {
  const phrase = PHRASES.find(([p]) => canonicalize(p.replace(/\s+/g, '')) === token);
  if (phrase) return phrase[1];
  const known: Readonly<Record<string, string>> = {
    javascript: 'JavaScript', typescript: 'TypeScript', nodejs: 'Node.js', nextjs: 'Next.js',
    csharp: 'C#', cpp: 'C++', objectivec: 'Objective-C', postgresql: 'PostgreSQL', mysql: 'MySQL',
    mongodb: 'MongoDB', googlecloud: 'Google Cloud', aws: 'AWS', azure: 'Azure', cicd: 'CI/CD',
    graphql: 'GraphQL', rest: 'REST', api: 'API', sql: 'SQL', nosql: 'NoSQL', etl: 'ETL',
    userexperience: 'User Experience', userinterface: 'User Interface', userresearch: 'User Research',
    qualityassurance: 'Quality Assurance', productmanagement: 'Product Management',
    peoplemanagement: 'People Management', changemanagement: 'Change Management',
    stakeholdermanagement: 'Stakeholder Management', publicspeaking: 'Public Speaking',
    technicalwriting: 'Technical Writing', machinelearning: 'Machine Learning', seo: 'SEO',
    sre: 'SRE', tdd: 'TDD', dbt: 'dbt', githubactions: 'GitHub Actions', dotnet: '.NET',
    saas: 'SaaS', b2b: 'B2B', b2c: 'B2C', crm: 'CRM', erp: 'ERP', hubspot: 'HubSpot',
    salesforce: 'Salesforce', pytorch: 'PyTorch', tensorflow: 'TensorFlow', bigquery: 'BigQuery',
  };
  if (known[token]) return known[token];
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/** Tone counts used by the sentiment reading. */
export function toneCounts(text: string): { positive: number; negative: number; hedges: number } {
  const lower = ` ${text.toLowerCase()} `;
  const count = (terms: readonly string[]): number =>
    terms.reduce((sum, term) => sum + (lower.split(term).length - 1), 0);
  return {
    positive: count(POSITIVE_TONE),
    negative: count(NEGATIVE_TONE),
    hedges: count(WEAK_OPENERS),
  };
}
