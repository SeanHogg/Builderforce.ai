import type { MetadataRoute } from 'next';
import { BLOG_POSTS } from '@/lib/blogData';
import { COMPETITOR_SEO, SEO_INTEGRATIONS } from '@/lib/content';
import { listPublishedSkillSlugs } from '@/lib/marketplaceSeo';

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
    { url: `${BASE}/evermind`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/product`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/compare`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/integrations`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/marketplace`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/prompts`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE}/media`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
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
    { url: `${BASE}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    // Feature routes — render a rich marketing page (RouteMarketing) to logged-out
    // visitors and crawlers, so they're indexable entry points to the product.
    { url: `${BASE}/brainstorm`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/ide`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/training`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/workflows`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/projects`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/workforce`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/skills`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/personas`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/security`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/dashboard`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/contributors`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/content-manager`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];

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

  // Public freelancer profiles — indexable Person pages. Best-effort.
  const talentPages: MetadataRoute.Sitemap = (await listPublicFreelancerIds()).map((id) => ({
    url: `${BASE}/talent/${id}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));

  return [...staticPages, ...blogPages, ...comparePages, ...integrationPages, ...marketplacePages, ...talentPages];
}
