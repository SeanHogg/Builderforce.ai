import { BUILTIN_SKILLS } from '@/lib/marketplaceData';
import { getPublishedSkill } from '@/lib/marketplaceSeo';

/**
 * Resolving ONE skill for `/skills/[slug]`, from either place a skill can live.
 *
 * A skill has two possible sources and the page must not care which: the shipped
 * BUILT-IN catalog (a static list in the frontend, with no marketplace row at
 * all) and the published Workforce Registry (an API read). The old client page
 * did this resolution in a `useEffect`, which is exactly why the route could
 * never have `generateMetadata` — the data did not exist until the browser ran.
 * Doing it here makes it a server read, so the title, description and JSON-LD are
 * in the HTML a crawler receives.
 */

export interface SkillDetailView {
  slug: string;
  name: string;
  description: string;
  category: string | null;
  version: string | null;
  author: string | null;
  tags: string[];
  /** Built-ins ship an emoji; published skills fall back to a neutral glyph. */
  emoji: string;
  readme: string | null;
  downloads: number | null;
  likes: number | null;
  /** True when the skill comes from the shipped catalog rather than the registry. */
  builtin: boolean;
  /**
   * Where this skill's ONE indexable URL is.
   *
   * A published skill is reachable at both `/skills/<slug>` and
   * `/marketplace/<slug>`, and those are the same product with the same copy —
   * two URLs competing for one entity is the duplicate-content problem this
   * whole route was supposed to fix, not create. So a published skill
   * canonicalises to its marketplace page (the richer one, with the readme and
   * the buy path) and only a BUILT-IN, which has no marketplace row, is
   * canonical here.
   */
  canonicalPath: string;
}

const DEFAULT_EMOJI = '✨';

/** One skill by slug, built-in first. Returns null when neither source has it.
 *  The sitemap's list of built-in slugs is `builtinSkillSlugs` in
 *  `lib/marketplaceSeo`, beside the API listers it is submitted with. */
export async function loadSkillDetail(slug: string): Promise<SkillDetailView | null> {
  const builtin = BUILTIN_SKILLS.find((s) => s.slug === slug);
  if (builtin) {
    return {
      slug: builtin.slug,
      name: builtin.name,
      description: builtin.description,
      category: builtin.category || null,
      version: builtin.version || null,
      author: builtin.author || null,
      tags: builtin.tags ?? [],
      emoji: builtin.emoji || DEFAULT_EMOJI,
      readme: null,
      downloads: builtin.downloads ?? null,
      likes: builtin.likes ?? null,
      builtin: true,
      canonicalPath: `/skills/${builtin.slug}`,
    };
  }

  const published = await getPublishedSkill(slug);
  if (!published) return null;
  return {
    slug: published.slug,
    name: published.name,
    description: published.description,
    category: published.category,
    version: published.version,
    author: published.author_display_name || published.author_username,
    tags: published.tags,
    emoji: DEFAULT_EMOJI,
    readme: published.readme,
    downloads: published.downloads,
    likes: published.likes,
    builtin: false,
    canonicalPath: `/marketplace/${published.slug}`,
  };
}
