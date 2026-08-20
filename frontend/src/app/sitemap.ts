import type { MetadataRoute } from 'next';
import { BLOG_POSTS } from '@/lib/blogData';
import { COMPETITOR_SEO, SEO_INTEGRATIONS } from '@/lib/content';
import {
  builtinPersonaSlugs,
  builtinSkillSlugs,
  listPublicAgentIds,
  listPublicPersonaSlugs,
  listPublicPromptSlugs,
  listPublishedSkillSlugs,
} from '@/lib/marketplaceSeo';
import { indexableTeaserRoutes } from '@/lib/routeMarketing';
import { getSalaryDirectory } from '@/lib/salary';
import { legalDocHref } from '@/lib/legalDocs';

const BASE = 'https://builderforce.ai';

/** Public (published + public-visibility) freelancer userIds for the sitemap.
 *  Best-effort: empty on any error so sitemap generation never fails. */
async function listPublicFreelancerIds(): Promise<string[]> {
  const apiBase = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';
  try {
    const res = await fetch(`${apiBase}/api/freelancers?pageSize=48`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: { userId: string }[] };
    return Array.isArray(body.items) ? body.items.map((f) => f.userId).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date().toISOString();

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${BASE}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/evermind`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/product`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/creation-canvas`, lastModified: now, changeFrequency: 'weekly', priority: 0.95 },
    { url: `${BASE}/compare`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/integrations`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/tutorials`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/marketplace`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/prompts`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE}/media`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/sell-builderforce`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/tools`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/tools/agentic-maturity`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/tools/ai-dev-maturity`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/tools/dora-quickcheck`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/tools/ai-cost-estimator`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/tools/cobit-governance`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/tools/delivery-risk`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/tools/incident-readiness`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/tools/security-posture`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/tools/tech-debt-estimator`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/tools/build-buy-agent`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/agents`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    // /agents sub-pages — each is a real, crawlable marketing surface in
    // PUBLIC_SHELL_PREFIXES (shellRouting.ts), so they belong here alongside
    // their parent rather than being reachable only by in-page link.
    { url: `${BASE}/agents/showcase`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/agents/skills`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/agents/integrations`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/agents/workflow-builder`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/agents/shoutouts`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/agents/acknowledgements`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/agents/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    // Trust surface. /soc2 and the /legal pages are the pages a buyer's security
    // reviewer looks for by name; they were indexable but unlisted. The two
    // published instruments outrank the notices: they are what a visitor is
    // bound by, and the URL an OAuth provider's verification asks for.
    { url: `${BASE}/soc2`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}${legalDocHref('privacy')}`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}${legalDocHref('terms')}`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/legal/compliance`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/legal/privacy-rights`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/legal/cookies`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/legal/subprocessors`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/legal/dpa`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/legal/ai-transparency`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/legal/accessibility`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    // Demand-capture surfaces.
    { url: `${BASE}/book-demo`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/demo`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];

  // Feature routes — every authenticated route renders a rich marketing page
  // (RouteMarketing) to logged-out visitors and crawlers, so each is a real
  // indexable entry point to the product.
  //
  // DERIVED from the same registry that renders them, not hand-listed. The
  // hand-listed version named twelve of these and silently omitted the rest, so
  // a surface added to the registry never reached the sitemap and nobody found
  // out. `indexableTeaserRoutes()` also drops the operator-only routes (admin,
  // workspaces, settings, agent worker), which keep their teaser but must not
  // be indexed.
  const teaserPages: MetadataRoute.Sitemap = indexableTeaserRoutes().map((route) => ({
    url: `${BASE}${route}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  const blogPages: MetadataRoute.Sitemap = BLOG_POSTS.map((post) => ({
    url: `${BASE}/blog/${post.slug}`,
    lastModified: post.date || now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  // Programmatic SEO leaf pages — "vs {competitor}" and "+ {tool}" long-tail.
  const comparePages: MetadataRoute.Sitemap = Object.values(COMPETITOR_SEO).map((c) => ({
    url: `${BASE}/compare/${c.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  const integrationPages: MetadataRoute.Sitemap = SEO_INTEGRATIONS.map((i) => ({
    url: `${BASE}/integrations/${i.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  // Published Workforce Registry skills — live, indexable detail pages. Best-effort
  // (empty on API error so sitemap generation never fails). [1333]
  const skillSlugs = await listPublishedSkillSlugs();
  const marketplacePages: MetadataRoute.Sitemap = skillSlugs.map((slug) => ({
    url: `${BASE}/marketplace/${slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  // ── Per-entity catalog pages ───────────────────────────────────────────────
  // The rest of the catalog, now that skills, personas, prompts and published
  // agents each have a real server-rendered detail route. All four reads are
  // best-effort through `publicApi`, so an unreachable API costs those URLs and
  // nothing else.
  //
  // Two placement rules decide which URL each entity is submitted under, and
  // both exist to keep ONE entity from occupying two rows:
  //
  //  · A skill published to the registry is submitted as `/marketplace/<slug>`
  //    (above). It is also reachable at `/skills/<slug>`, but that page
  //    canonicalises to the marketplace URL, so only the BUILT-IN skills — which
  //    have no marketplace row at all — are listed under `/skills/`.
  //  · The `/skills`, `/personas` and `/prompts` INDEX pages are not listed
  //    here: `/skills` and `/personas` arrive via `indexableTeaserRoutes()` (they
  //    keep their marketing teaser and stay outside `PUBLIC_SHELL_PREFIXES`),
  //    and `/prompts` is already in `staticPages`.
  const [personaSlugs, promptSlugs, agentIds] = await Promise.all([
    listPublicPersonaSlugs(),
    listPublicPromptSlugs(),
    listPublicAgentIds(),
  ]);

  // Built-ins first so a published persona that shadows a built-in slug does not
  // produce two rows for one URL.
  const personaUrls = [...new Set([...builtinPersonaSlugs(), ...personaSlugs])];

  const catalogPages: MetadataRoute.Sitemap = [
    ...builtinSkillSlugs().map((slug) => ({
      url: `${BASE}/skills/${slug}`,
      lastModified: now,
      // Built-ins change with a release, not with traffic — same cadence as the
      // other shipped-content pages rather than the marketplace's weekly.
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...personaUrls.map((slug) => ({
      url: `${BASE}/personas/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...promptSlugs.map((slug) => ({
      url: `${BASE}/prompts/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...agentIds.map((id) => ({
      url: `${BASE}/marketplace/agent/${id}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];

  // Public freelancer profiles — indexable Person pages. Best-effort.
  const talentPages: MetadataRoute.Sitemap = (await listPublicFreelancerIds()).map((id) => ({
    url: `${BASE}/talent/${id}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));

  // Salary guides — the largest programmatic-SEO surface here: every role page plus
  // every role×city leaf. Both come from ONE catalog read, so a role added on the
  // server appears in the sitemap without anyone editing this file. Best-effort:
  // an unreachable API yields no salary URLs rather than failing the whole sitemap.
  const salaryDirectory = await getSalaryDirectory();
  const salaryRoles = salaryDirectory?.roles ?? [];
  const salaryCities = salaryDirectory?.cities ?? [];
  const salaryPages: MetadataRoute.Sitemap = [
    ...salaryRoles.map((role) => ({
      url: `${BASE}/salary/${role.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...salaryRoles.flatMap((role) => salaryCities.map((city) => ({
      url: `${BASE}/salary/${role.slug}/${city.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }))),
  ];

  return [
    ...staticPages, ...teaserPages, ...blogPages, ...comparePages,
    ...integrationPages, ...marketplacePages, ...catalogPages, ...talentPages,
    ...salaryPages,
  ];
}
