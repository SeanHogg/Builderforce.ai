/**
 * Server-safe read helpers for the PUBLIC, indexable entity detail surfaces —
 * `/marketplace/[slug]` (skills), `/personas/[slug]`, `/prompts/[slug]`,
 * `/marketplace/agent/[id]` — and for `sitemap.ts`.
 *
 * No client-only imports (localStorage, auth) so every helper is usable from a
 * server component, from `generateMetadata` and from the sitemap. Reads go
 * through `lib/publicApi` — the one uncredentialed server read, which owns the
 * base URL, the data-cache window and the degrade-to-null contract.
 *
 * ── Why ONE reader and four descriptors ──────────────────────────────────────
 * Each of the four public catalogs answers the same two questions ("give me one
 * by its public key" and "give me every public key") and each answers them with
 * a slightly different envelope: skills come back as `{ skill }`, personas and
 * prompts as a BARE object, published agents as a bare ARRAY. Writing four
 * readers meant four copies of the fetch, the null check and the tag parsing,
 * and copies drift — the pre-existing skill reader already carried its own
 * private version of a contract `publicApi` owns. So the transport is written
 * once in `publicEntityReaders` and each catalog contributes only what actually
 * differs: its paths, how to unwrap its envelope, and how to normalise a row.
 */

import { BUILTIN_PERSONAS, BUILTIN_SKILLS } from './marketplaceData';
import { publicApiGet } from './publicApi';

/* ════════════════ Field coercion ════════════════ */

/** Tags/skills arrive as a real array, a JSON-encoded array, or a CSV string. */
function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
    } catch {
      return raw.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }
  return [];
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const nullableNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The value as a plain object, or null when it is not one. */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/* ════════════════ The one parameterised reader ════════════════ */

interface PublicEntitySource<T> {
  /** Endpoint for ONE entity, keyed by its public identifier (slug or id). */
  detailPath: (key: string) => string;
  /** Endpoint for the listing the sitemap enumerates. */
  listPath: (limit: number) => string;
  /** Highest `limit` the endpoint honours — it silently clamps above this. */
  maxLimit: number;
  /**
   * The property each endpoint wraps its payload in, or null when it answers
   * bare. Detail and list are named separately because they genuinely differ per
   * catalog: skills answer `{ skill }` / `{ skills }`, personas and prompts wrap
   * only the LIST and return the detail row bare, agents wrap neither.
   *
   * Name an envelope only where the server actually sends one. `unwrap` does
   * fall through to the body when the property is absent, which makes a
   * speculative name look free — it is not. A persona row has its own `persona`
   * property (the nested behaviour body), so declaring `'persona'` here silently
   * unwrapped every read down to the body and threw the row away.
   */
  detailEnvelope: string | null;
  listEnvelope: string | null;
  /** Normalise one raw row into the view the pages and the sitemap render. */
  map: (raw: Record<string, unknown>, key: string) => T;
  /** The sitemap key (slug or id) of a listed row. */
  keyOf: (raw: Record<string, unknown>) => string | null;
}

/** Unwrap `{ <envelope>: X }`, or take the body itself when it is already X. */
function unwrap(body: unknown, envelope: string | null): unknown {
  if (envelope) {
    const record = asRecord(body);
    if (record && envelope in record) return record[envelope];
  }
  return body;
}

interface PublicEntityReaders<T> {
  /** One entity for SSR/metadata. Null on a miss, a 404 or an unreachable API. */
  get: (key: string) => Promise<T | null>;
  /** Public keys for the sitemap. Best-effort; empty array on any error. */
  listKeys: (limit?: number) => Promise<string[]>;
}

function publicEntityReaders<T>(source: PublicEntitySource<T>): PublicEntityReaders<T> {
  return {
    async get(key) {
      if (!key) return null;
      const body = await publicApiGet<unknown>(source.detailPath(encodeURIComponent(key)));
      const raw = asRecord(unwrap(body, source.detailEnvelope));
      // `publicApiGet` already nulls a non-2xx; this also rejects a 200 whose
      // body is an error envelope rather than an entity.
      if (!raw || 'error' in raw) return null;
      return source.map(raw, key);
    },
    async listKeys(limit = 500) {
      const body = await publicApiGet<unknown>(source.listPath(Math.min(limit, source.maxLimit)));
      const rows = unwrap(body, source.listEnvelope);
      if (!Array.isArray(rows)) return [];
      return rows
        .map((row) => {
          const record = asRecord(row);
          return record ? source.keyOf(record) : null;
        })
        .filter((key): key is string => typeof key === 'string' && key.length > 0);
    },
  };
}

/* ════════════════ Skills — /marketplace/[slug] ════════════════ */

export interface PublishedSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string | null;
  tags: string[];
  version: string | null;
  readme: string | null;
  icon_url: string | null;
  repo_url: string | null;
  downloads: number | null;
  likes: number | null;
  author_username: string | null;
  author_display_name: string | null;
}

/** `?seo=1` is the no-side-effect variant — it does not bump the download counter. */
const skillReaders = publicEntityReaders<PublishedSkill>({
  detailPath: (slug) => `/marketplace/skills/${slug}?seo=1`,
  listPath: (limit) => `/marketplace/skills?limit=${limit}`,
  maxLimit: 500,
  detailEnvelope: 'skill',
  listEnvelope: 'skills',
  keyOf: (r) => nullableStr(r.slug),
  map: (s, slug) => ({
    id: str(s.id),
    name: str(s.name),
    slug: str(s.slug, slug),
    description: str(s.description),
    category: nullableStr(s.category),
    tags: parseTags(s.tags),
    version: nullableStr(s.version),
    readme: nullableStr(s.readme),
    icon_url: nullableStr(s.icon_url),
    repo_url: nullableStr(s.repo_url),
    downloads: nullableNum(s.downloads),
    likes: nullableNum(s.likes),
    author_username: nullableStr(s.author_username),
    author_display_name: nullableStr(s.author_display_name),
  }),
});

/** Fetch one published skill for SSR/metadata. Returns null on miss/error. */
export const getPublishedSkill = skillReaders.get;
/** Published skill slugs for the sitemap. Best-effort; empty on error. */
export const listPublishedSkillSlugs = skillReaders.listKeys;

/* ════════════════ Personas — /personas/[slug] ════════════════ */

export interface PublicPersonaSeo {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  /** Behaviour fields, FLATTENED off the nested `persona` body the server sends. */
  voice: string;
  perspective: string;
  decisionStyle: string;
  outputPrefix: string;
  capabilities: string[];
  image: string | null;
  authorName: string | null;
  installCount: number | null;
  likeCount: number | null;
  updatedAt: string | null;
}

/**
 * The listing is `/public` (wrapped in `{ personas }`); the detail route is the
 * catch-all `/:slug`, registered LAST on the server so the literal `/public`,
 * `/mine` and `/psychometric/*` routes win — and it answers the row BARE.
 *
 * `detailEnvelope` is null and MUST stay null. Naming it `'persona'` as a
 * belt-and-braces tolerance is not harmless here: a persona row carries its own
 * `persona` property — the nested behaviour body — so the unwrap matched it and
 * every read returned the body in place of the row, losing the name, the slug,
 * the author and the counters. The unit test for this file caught it.
 */
const personaReaders = publicEntityReaders<PublicPersonaSeo>({
  detailPath: (slug) => `/api/personas/${slug}`,
  listPath: (limit) => `/api/personas/public?limit=${limit}`,
  maxLimit: 100,
  detailEnvelope: null,
  listEnvelope: 'personas',
  keyOf: (r) => nullableStr(r.slug),
  map: (p, slug) => {
    const body = asRecord(p.persona) ?? {};
    return {
      id: str(p.id),
      slug: str(p.slug, slug),
      name: str(p.name, slug),
      description: str(p.description),
      category: nullableStr(p.category),
      tags: parseTags(p.tags),
      voice: str(body.voice),
      perspective: str(body.perspective),
      decisionStyle: str(body.decisionStyle),
      outputPrefix: str(body.outputPrefix),
      capabilities: parseTags(body.capabilities),
      image: nullableStr(body.image),
      authorName: nullableStr(p.authorName),
      installCount: nullableNum(p.installCount),
      likeCount: nullableNum(p.likeCount),
      updatedAt: nullableStr(p.updatedAt),
    };
  },
});

/** Fetch one published persona for SSR/metadata. Returns null on miss/error. */
export const getPublicPersona = personaReaders.get;
/** Published persona slugs for the sitemap. Best-effort; empty on error. */
export const listPublicPersonaSlugs = personaReaders.listKeys;

/* ════════════════ Prompts — /prompts/[slug] ════════════════ */

export interface PublicPromptVariable {
  name: string;
  description: string | null;
  default: string | null;
}

export interface PublicPromptSeo {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  tags: string[];
  authorName: string | null;
  currentVersion: number | null;
  usageCount: number | null;
  starCount: number | null;
  isFeatured: boolean;
  /** The prompt text itself — the whole reason this page is worth indexing. */
  body: string;
  variables: PublicPromptVariable[];
  model: string | null;
  updatedAt: string | null;
}

function parseVariables(raw: unknown): PublicPromptVariable[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((v) => asRecord(v))
    .filter((v): v is Record<string, unknown> => v !== null && typeof v.name === 'string')
    .map((v) => ({
      name: str(v.name),
      description: nullableStr(v.description),
      default: nullableStr(v.default),
    }));
}

/** `GET /public/:slug` is the READ; `POST /public/:slug/use` is what counts a use. */
const promptReaders = publicEntityReaders<PublicPromptSeo>({
  detailPath: (slug) => `/api/prompts/public/${slug}`,
  listPath: (limit) => `/api/prompts/public?limit=${limit}`,
  maxLimit: 100,
  // Bare, like personas — an envelope name is only ever declared when the server
  // actually sends one, never speculatively. See the persona note above.
  detailEnvelope: null,
  listEnvelope: 'prompts',
  keyOf: (r) => nullableStr(r.slug),
  map: (p, slug) => ({
    id: str(p.id),
    slug: str(p.slug, slug),
    title: str(p.title, slug),
    description: str(p.description),
    category: nullableStr(p.category),
    tags: parseTags(p.tags),
    authorName: nullableStr(p.authorName),
    currentVersion: nullableNum(p.currentVersion),
    usageCount: nullableNum(p.usageCount),
    starCount: nullableNum(p.starCount),
    isFeatured: p.isFeatured === true,
    body: str(p.body),
    variables: parseVariables(p.variables),
    model: nullableStr(p.model),
    updatedAt: nullableStr(p.updatedAt),
  }),
});

/** Fetch one public prompt for SSR/metadata. Returns null on miss/error. */
export const getPublicPrompt = promptReaders.get;
/** Public prompt slugs for the sitemap. Best-effort; empty on error. */
export const listPublicPromptSlugs = promptReaders.listKeys;

/* ════════════════ Published agents — /marketplace/agent/[id] ════════════════ */

export interface PublicAgentSeo {
  id: string;
  name: string;
  title: string;
  bio: string;
  skills: string[];
  baseModel: string | null;
  builtinKind: string | null;
  hireCount: number | null;
  /** 0..1 evaluation score; null when the agent has not been scored. */
  evalScore: number | null;
  priceCents: number | null;
  pricingModel: string | null;
  priceUnit: string | null;
  runtimeSupport: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Agents are keyed by ID, not slug — `ide_agents` has no public slug column. */
const agentReaders = publicEntityReaders<PublicAgentSeo>({
  detailPath: (id) => `/api/workforce/agents/${id}`,
  // The route takes no `limit`; it serves the top 200 published agents.
  listPath: () => '/api/workforce/agents',
  maxLimit: 200,
  // Both routes answer BARE (an array, an object) — there is no envelope.
  detailEnvelope: null,
  listEnvelope: null,
  keyOf: (r) => (r.id == null ? null : String(r.id)),
  map: (a, id) => ({
    id: a.id == null ? id : String(a.id),
    name: str(a.name, id),
    title: str(a.title),
    bio: str(a.bio),
    skills: parseTags(a.skills),
    baseModel: nullableStr(a.base_model),
    builtinKind: nullableStr(a.builtin_kind),
    hireCount: nullableNum(a.hire_count),
    evalScore: nullableNum(a.evalScore),
    priceCents: nullableNum(a.price_cents),
    pricingModel: nullableStr(a.pricing_model),
    priceUnit: nullableStr(a.price_unit),
    runtimeSupport: nullableStr(a.runtime_support),
    createdAt: nullableStr(a.created_at),
    updatedAt: nullableStr(a.updated_at),
  }),
});

/** Fetch one published agent for SSR/metadata. Returns null on miss/error. */
export const getPublicAgent = agentReaders.get;
/** Published agent ids for the sitemap. Best-effort; empty on error. */
export const listPublicAgentIds = agentReaders.listKeys;

/* ════════════════ Built-in catalogs the sitemap also lists ════════════════ */

/**
 * The shipped built-ins are the half of the catalog that is NOT an API read, and
 * the sitemap needs both halves. They live here rather than beside their page
 * loaders so `sitemap.ts` has exactly one import for "which catalog URLs exist"
 * — and so it never has to reach into an `app/[slug]/` directory for data.
 */

/** Built-in skill slugs. These own `/skills/<slug>`: they have no marketplace row. */
export function builtinSkillSlugs(): string[] {
  return BUILTIN_SKILLS.map((s) => s.slug);
}

/** Built-in persona slugs. A built-in persona is keyed by its (slug-shaped) `name`. */
export function builtinPersonaSlugs(): string[] {
  return BUILTIN_PERSONAS.map((p) => p.name);
}
