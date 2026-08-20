import { BUILTIN_PERSONAS } from '@/lib/marketplaceData';
import { getPublicPersona } from '@/lib/marketplaceSeo';

/**
 * Resolving ONE persona for `/personas/[slug]`, from either place a persona can
 * live: the shipped BUILT-IN set (a static frontend list, keyed by `name`, which
 * IS its slug) and the public registry (`GET /api/personas/:slug`).
 *
 * Same story as the skills sibling — the old page did this in a `useEffect`, so
 * the route could not have `generateMetadata`. Reading on the server puts the
 * persona's voice, perspective and decision style into the HTML a crawler sees.
 */

export interface PersonaDetailView {
  slug: string;
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  voice: string;
  perspective: string;
  decisionStyle: string;
  outputPrefix: string;
  capabilities: string[];
  author: string | null;
  installCount: number | null;
  likeCount: number | null;
  /** True when the persona comes from the shipped set rather than the registry. */
  builtin: boolean;
}

/** Placeholder for a behaviour field the source left blank. */
const UNSET = '—';

/** One persona by slug, built-in first. Returns null when neither source has it.
 *  The sitemap's list of built-in slugs is `builtinPersonaSlugs` in
 *  `lib/marketplaceSeo`, beside the API listers it is submitted with. */
export async function loadPersonaDetail(slug: string): Promise<PersonaDetailView | null> {
  // Built-in personas are keyed by `name`; that name is already slug-shaped
  // ('code-reviewer'), which is why the URL and the artifact key are the same
  // string for both sources and the stats/assignment calls need no branch.
  const builtin = BUILTIN_PERSONAS.find((p) => p.name === slug);
  if (builtin) {
    return {
      slug: builtin.name,
      name: builtin.name,
      description: builtin.description,
      category: null,
      tags: builtin.tags ?? [],
      voice: builtin.voice || UNSET,
      perspective: builtin.perspective || UNSET,
      decisionStyle: builtin.decisionStyle || UNSET,
      outputPrefix: builtin.outputPrefix ?? '',
      capabilities: builtin.capabilities ?? [],
      author: builtin.author ?? null,
      installCount: builtin.downloads ?? null,
      likeCount: builtin.likes ?? null,
      builtin: true,
    };
  }

  const published = await getPublicPersona(slug);
  if (!published) return null;
  return {
    slug: published.slug,
    name: published.name || published.slug,
    description: published.description,
    category: published.category,
    tags: published.tags,
    voice: published.voice || UNSET,
    perspective: published.perspective || UNSET,
    decisionStyle: published.decisionStyle || UNSET,
    outputPrefix: published.outputPrefix,
    capabilities: published.capabilities,
    author: published.authorName,
    installCount: published.installCount,
    likeCount: published.likeCount,
    builtin: false,
  };
}
