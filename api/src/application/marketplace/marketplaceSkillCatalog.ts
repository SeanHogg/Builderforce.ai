/**
 * THE published marketplace skill catalogue — one reader for every surface.
 *
 * `/marketplace/skills` (the community site, world-readable) and `/api/v1/skills`
 * (the developer API, tenant API key) each carried their own copy of the same
 * select-join-paginate over `marketplace_skills`, with diverging column lists and
 * orderings, and only the first was cached. The query, its cache and the version
 * token every skill write bumps live here now, so both surfaces answer the same
 * question the same way and a publish refreshes both at once.
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { marketplaceSkills, users } from '../../infrastructure/database/schema';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import { skillSearchMatches } from './skillSearch';

/** Version token for the list keyspace. The list is searchable + paginated, so the
 *  keyspace is unbounded: the token is folded into every key and bumped on write,
 *  orphaning every cached variant at once. */
const SKILLS_LIST_VERSION_KEY = 'marketplace:skills:list';
const SKILLS_LIST_CACHE_TTL_SECONDS = 120;

/** Read-through cache key for one published skill's SEO/SSR payload. */
export const skillSeoCacheKey = (slug: string): string => `mp:skill:seo:${slug}`;

/** Drop every cached list variant. Every skill write (create / update / publish toggle) calls it. */
export async function invalidateSkillsList(env: Env): Promise<void> {
  await bumpCacheVersion(env, SKILLS_LIST_VERSION_KEY);
}

export interface SkillListQuery {
  category?: string;
  q?: string;
  page?: string | number;
  limit?: string | number;
}

export interface SkillListPage {
  skills: unknown[];
  total: number;
  page: number;
  limit: number;
}

const listColumns = {
  id:              marketplaceSkills.id,
  name:            marketplaceSkills.name,
  slug:            marketplaceSkills.slug,
  description:     marketplaceSkills.description,
  category:        marketplaceSkills.category,
  tags:            marketplaceSkills.tags,
  version:         marketplaceSkills.version,
  icon_url:        marketplaceSkills.iconUrl,
  repo_url:        marketplaceSkills.repoUrl,
  downloads:       marketplaceSkills.downloads,
  likes:           marketplaceSkills.likes,
  price_cents:     marketplaceSkills.priceCents,
  pricing_model:   marketplaceSkills.pricingModel,
  price_unit:      marketplaceSkills.priceUnit,
  created_at:      marketplaceSkills.createdAt,
  author_username: users.username,
  author_display_name: users.displayName,
  author_avatar_url:   users.avatarUrl,
};

/** Clamp the paging inputs the way both routes always did. */
function paging(query: SkillListQuery): { pageNum: number; limitNum: number; offset: number } {
  const pageNum = Math.max(1, Number(query.page ?? 1) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(query.limit ?? 24) || 24));
  return { pageNum, limitNum, offset: (pageNum - 1) * limitNum };
}

/** Published skills, optionally filtered by category and keyword. Cached. */
export async function listPublishedSkills(env: Env, db: Db, query: SkillListQuery): Promise<SkillListPage> {
  const { pageNum, limitNum, offset } = paging(query);
  const { category, q } = query;
  const version = await getCacheVersion(env, SKILLS_LIST_VERSION_KEY);
  const cacheKey = `mp:skills:list:v:${version}:c=${category ?? ''}:q=${q ?? ''}:p=${pageNum}:l=${limitNum}`;
  return getOrSetCached(
    env,
    cacheKey,
    () => loadSkillsPage(db, { category, q, pageNum, limitNum, offset }),
    { kvTtlSeconds: SKILLS_LIST_CACHE_TTL_SECONDS },
  );
}

async function loadSkillsPage(
  db: Db,
  args: { category?: string; q?: string; pageNum: number; limitNum: number; offset: number },
): Promise<SkillListPage> {
  const conditions: SQL[] = [eq(marketplaceSkills.published, true)];
  if (args.category) conditions.push(eq(marketplaceSkills.category, args.category));
  const where = and(...conditions);

  const [rows, [countRow]] = await Promise.all([
    db
      .select(listColumns)
      .from(marketplaceSkills)
      .innerJoin(users, eq(marketplaceSkills.authorId, users.id))
      .where(args.q ? and(where, skillSearchMatches(args.q)) : where)
      .orderBy(desc(marketplaceSkills.downloads), desc(marketplaceSkills.likes))
      .limit(args.limitNum)
      .offset(args.offset),
    // The count deliberately ignores `q`: both surfaces always reported the
    // category total beside a keyword page, and clients page on it.
    db.select({ count: sql<number>`count(*)` }).from(marketplaceSkills).where(where),
  ]);

  return { skills: rows, total: Number(countRow?.count ?? 0), page: args.pageNum, limit: args.limitNum };
}

/**
 * One published skill + its author, for the public detail / SSR surface. A PAID skill's
 * `readme` (its instructions — what checkout sells) is withheld: this surface has no
 * caller to check an entitlement for, and it is cached publicly. `description` stays.
 */
export async function loadPublishedSkill(db: Db, slug: string) {
  const [row] = await db
    .select({
      id:              marketplaceSkills.id,
      name:            marketplaceSkills.name,
      slug:            marketplaceSkills.slug,
      description:     marketplaceSkills.description,
      category:        marketplaceSkills.category,
      tags:            marketplaceSkills.tags,
      version:         marketplaceSkills.version,
      readme:          marketplaceSkills.readme,
      price_cents:     marketplaceSkills.priceCents,
      icon_url:        marketplaceSkills.iconUrl,
      repo_url:        marketplaceSkills.repoUrl,
      downloads:       marketplaceSkills.downloads,
      likes:           marketplaceSkills.likes,
      created_at:      marketplaceSkills.createdAt,
      updated_at:      marketplaceSkills.updatedAt,
      author_username: users.username,
      author_display_name: users.displayName,
      author_avatar_url:   users.avatarUrl,
    })
    .from(marketplaceSkills)
    .innerJoin(users, eq(marketplaceSkills.authorId, users.id))
    .where(and(eq(marketplaceSkills.slug, slug), eq(marketplaceSkills.published, true)))
    .limit(1);
  if (!row) return null;
  return row.price_cents > 0 ? { ...row, readme: null } : row;
}
