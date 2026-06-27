/**
 * JSON-LD structured data builders for SEO/GEO.
 *
 * Each function returns a plain object suitable for JSON.stringify()
 * inside a <script type="application/ld+json"> tag.
 */

import {
  BRAND,
  HOMEPAGE_FAQ,
  PRICING_FAQ,
  LOGIN_FAQ,
  REGISTER_FAQ,
  BLOG_FAQ,
  COMPARE_FAQ,
  EVERMIND,
  EVERMIND_FAQ,
  COMPARE,
  COMPETITIVE_COMPARISON,
  DEFINED_TERMS,
  PRICING_PLANS,
  PRODUCT_SECTIONS,
  PROJECTS_TASKS_FAQ,
  type FaqItem,
  type CompetitorSeo,
  type IntegrationSeo,
} from './content';

/* ════════ Helpers ════════ */

function faqSchema(items: FaqItem[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  };
}

function breadcrumbs(...items: { name: string; url: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

const organization = {
  '@type': 'Organization',
  '@id': `${BRAND.url}/#organization`,
  name: BRAND.legalName,
  url: BRAND.url,
  logo: { '@type': 'ImageObject', url: `${BRAND.url}/icon.png` },
  founder: {
    '@type': 'Person',
    name: BRAND.founder.name,
    url: BRAND.founder.url,
    jobTitle: 'Founder',
    worksFor: { '@type': 'Organization', name: BRAND.legalName },
  },
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    url: BRAND.url,
  },
  dateModified: BRAND.dateModified,
};

const authorPerson = {
  '@type': 'Person',
  name: BRAND.founder.name,
  url: BRAND.founder.url,
  jobTitle: 'Founder',
  worksFor: { '@type': 'Organization', name: BRAND.legalName },
};

/* ════════ Page-level schema graphs ════════ */

/** Homepage: Organization + SoftwareApplication + WebSite + Pricing + FAQ + DefinedTerms */
export function homepageSchema() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'SoftwareApplication',
        '@id': `${BRAND.url}/#app`,
        name: BRAND.name,
        description:
          'A human-in-the-loop, fully agentic cloud. Train your own AI agents and use them inside your own agent, manage your workforce on a Kanban board, and review and approve every action without leaving VS Code. WebGPU LoRA fine-tuning in the browser, skills marketplace, personas, and the Workforce Registry.',
        url: BRAND.url,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        author: { '@id': `${BRAND.url}/#organization` },
        dateModified: BRAND.dateModified,
        offers: PRICING_PLANS.map((plan) => ({
          '@type': 'Offer',
          name: plan.name,
          price: String(plan.priceNumeric),
          priceCurrency: 'USD',
          description: plan.description,
          ...(plan.period && {
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: String(plan.priceNumeric),
              priceCurrency: 'USD',
              unitText: plan.period.replace(/^\//, ''),
            },
          }),
        })),
      },
      {
        '@type': 'WebSite',
        '@id': `${BRAND.url}/#website`,
        url: BRAND.url,
        name: BRAND.name,
        publisher: { '@id': `${BRAND.url}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: `${BRAND.url}/marketplace?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      faqSchema(HOMEPAGE_FAQ),
      {
        '@type': 'DefinedTermSet',
        name: 'Builderforce.ai Concepts',
        url: BRAND.url,
        hasDefinedTerm: DEFINED_TERMS.map((term) => ({
          '@type': 'DefinedTerm',
          name: term.name,
          description: term.description,
          inDefinedTermSet: `${BRAND.url}/#concepts`,
        })),
      },
      breadcrumbs({ name: 'Home', url: BRAND.url }),
    ],
  };
}

/** Blog index: CollectionPage + ItemList + BreadcrumbList + FAQ */
export function blogIndexSchema(posts: { slug: string; title: string; date: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: 'Builderforce Blog',
        description:
          'Deep dives, tutorials, and best practices for building and deploying AI agents with WebGPU LoRA training.',
        url: `${BRAND.url}/blog`,
        dateModified: BRAND.dateModified,
        publisher: { '@id': `${BRAND.url}/#organization` },
      },
      {
        '@type': 'ItemList',
        itemListElement: posts.slice(0, 20).map((post, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${BRAND.url}/blog/${post.slug}`,
          name: post.title,
        })),
      },
      faqSchema(BLOG_FAQ),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Blog', url: `${BRAND.url}/blog` },
      ),
    ],
  };
}

/** Workforce marketplace: CollectionPage + ItemList of published agents, each a
 *  SoftwareApplication carrying its discovery tags as `keywords` so search/LLM
 *  crawlers can find published agents by tag (server-rendered) [1241]. */
export function marketplaceAgentsSchema(
  agents: { id: string | number; name: string; description?: string | null; skills?: string[] | null }[],
) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: 'Workforce Marketplace',
        description: 'Browse and hire published AI agents, skills, and personas on the Builderforce.ai Workforce Registry.',
        url: `${BRAND.url}/marketplace`,
        publisher: { '@id': `${BRAND.url}/#organization` },
      },
      {
        '@type': 'ItemList',
        itemListElement: agents.slice(0, 100).map((a, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'SoftwareApplication',
            name: a.name,
            applicationCategory: 'BusinessApplication',
            url: `${BRAND.url}/marketplace?agent=${encodeURIComponent(String(a.id))}`,
            ...(a.description ? { description: a.description } : {}),
            ...(a.skills && a.skills.length > 0 ? { keywords: a.skills.join(', ') } : {}),
          },
        })),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Marketplace', url: `${BRAND.url}/marketplace` },
      ),
    ],
  };
}

/** Individual blog post: Article + BreadcrumbList */
export function blogPostSchema(post: {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: post.title,
        description: post.description,
        url: `${BRAND.url}/blog/${post.slug}`,
        image: `${BRAND.url}/og-image.png`,
        datePublished: post.date,
        dateModified: post.date,
        author: {
          ...authorPerson,
          ...(post.author && { name: post.author }),
        },
        publisher: {
          '@type': 'Organization',
          name: BRAND.legalName,
          logo: { '@type': 'ImageObject', url: `${BRAND.url}/icon.png` },
        },
        mainEntityOfPage: {
          '@type': 'WebPage',
          '@id': `${BRAND.url}/blog/${post.slug}`,
        },
        keywords: post.tags.join(', '),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Blog', url: `${BRAND.url}/blog` },
        { name: post.title, url: `${BRAND.url}/blog/${post.slug}` },
      ),
    ],
  };
}

/** Product tour page: SoftwareApplication + ItemList of capabilities + BreadcrumbList */
export function productSchema() {
  const surfaces = PRODUCT_SECTIONS.flatMap((s) => s.surfaces);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'SoftwareApplication',
        '@id': `${BRAND.url}/#app`,
        name: BRAND.name,
        description:
          'Builderforce.ai is an AI platform that builds, trains, orchestrates, and governs a custom AI agent workforce — dataset generation, in-browser WebGPU LoRA training, AI evaluation, a skills marketplace, workflow orchestration, a workforce mesh, and full approvals + audit.',
        url: `${BRAND.url}/product`,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        author: { '@id': `${BRAND.url}/#organization` },
        dateModified: BRAND.dateModified,
        featureList: surfaces.map((f) => f.title),
      },
      {
        '@type': 'ItemList',
        name: 'Builderforce.ai product capabilities',
        itemListElement: surfaces.map((f, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: f.title,
          description: f.desc,
          url: `${BRAND.url}${f.href}`,
        })),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Product', url: `${BRAND.url}/product` },
      ),
    ],
  };
}

/** Evermind page: the Builderforce.ai LLM as a SoftwareApplication + ItemList of its layers + FAQ + DefinedTerms + BreadcrumbList */
export function evermindSchema() {
  const url = `${BRAND.url}/evermind`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'SoftwareApplication',
        '@id': `${BRAND.url}/#evermind`,
        name: `${EVERMIND.name} — the ${BRAND.name} LLM`,
        alternateName: [EVERMIND.name, `${BRAND.name} LLM`, 'Builderforce LLM'],
        description: EVERMIND.seo.description,
        url,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web (WebGPU)',
        author: { '@id': `${BRAND.url}/#organization` },
        dateModified: BRAND.dateModified,
        featureList: EVERMIND.pillars.map((p) => p.title),
      },
      {
        '@type': 'ItemList',
        name: 'Evermind architecture',
        itemListElement: EVERMIND.pillars.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: p.title,
          description: p.desc,
          url,
        })),
      },
      faqSchema(EVERMIND_FAQ),
      {
        '@type': 'DefinedTermSet',
        name: 'Evermind concepts',
        url,
        hasDefinedTerm: DEFINED_TERMS.filter((t) => t.name === 'Evermind' || t.name === 'Write-Through Cognition').map((term) => ({
          '@type': 'DefinedTerm',
          name: term.name,
          description: term.description,
          inDefinedTermSet: `${url}#concepts`,
        })),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Evermind', url },
      ),
    ],
  };
}

/** Projects / Tasks page: SoftwareApplication feature + ItemList of the two capabilities + FAQ + BreadcrumbList */
export function projectsTasksSchema() {
  const capabilities = [
    {
      name: 'Projects',
      description:
        'Collaborative AI project workspaces — each with a full in-browser IDE, files, assigned agents, and workflows. View projects as cards, a table, a calendar, or a Gantt timeline.',
    },
    {
      name: 'Tasks',
      description:
        'A task board for your agent workforce — plan, prioritize, and assign tasks to AgentHosts, then watch them flow through every status across a board, table, calendar, or Gantt view.',
    },
  ];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'SoftwareApplication',
        '@id': `${BRAND.url}/#projects-tasks`,
        name: `${BRAND.name} — Projects / Tasks`,
        description:
          'Projects / Tasks is the work-management surface of Builderforce.ai: organize work into AI project workspaces, then plan, assign, and track tasks across your agent workforce with board, table, calendar, and Gantt views, approval gates, and full observability.',
        url: `${BRAND.url}/projects`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        author: { '@id': `${BRAND.url}/#organization` },
        dateModified: BRAND.dateModified,
        featureList: capabilities.map((c) => c.name),
      },
      {
        '@type': 'ItemList',
        name: 'Builderforce.ai Projects / Tasks capabilities',
        itemListElement: capabilities.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.name,
          description: c.description,
          url: `${BRAND.url}/projects`,
        })),
      },
      faqSchema(PROJECTS_TASKS_FAQ),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Projects / Tasks', url: `${BRAND.url}/projects` },
      ),
    ],
  };
}

/** Compare page: SoftwareApplication + ItemList of compared capabilities + FAQ + BreadcrumbList */
export function compareSchema() {
  const features = COMPETITIVE_COMPARISON.flatMap((c) => c.rows.map((r) => r.feature));
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'SoftwareApplication',
        '@id': `${BRAND.url}/#app`,
        name: BRAND.name,
        description: COMPARE.seo.description,
        url: `${BRAND.url}/compare`,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        author: { '@id': `${BRAND.url}/#organization` },
        dateModified: BRAND.dateModified,
        featureList: features,
      },
      {
        '@type': 'ItemList',
        name: 'Builderforce.ai capabilities compared to other AI coding tools',
        itemListElement: COMPETITIVE_COMPARISON.map((cat, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: cat.title,
          description: cat.blurb,
        })),
      },
      faqSchema(COMPARE_FAQ),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Compare', url: `${BRAND.url}/compare` },
      ),
    ],
  };
}

/** Pricing page: Product with Offers + FAQ + BreadcrumbList */
export function pricingSchema() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        name: BRAND.name,
        description: 'AI agent training platform with Free, Pro, and Teams plans.',
        url: `${BRAND.url}/pricing`,
        brand: { '@id': `${BRAND.url}/#organization` },
        offers: PRICING_PLANS.map((plan) => ({
          '@type': 'Offer',
          name: plan.name,
          price: String(plan.priceNumeric),
          priceCurrency: 'USD',
          description: plan.description,
          url: `${BRAND.url}${plan.ctaHref}`,
        })),
      },
      faqSchema(PRICING_FAQ),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Pricing', url: `${BRAND.url}/pricing` },
      ),
    ],
  };
}

/** Login page: WebPage + FAQ + BreadcrumbList */
export function loginSchema() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: 'Sign In to Builderforce.ai',
        description:
          'Sign in to your Builderforce.ai account. Access AI agent training, datasets, and the Workforce Registry.',
        url: `${BRAND.url}/login`,
        dateModified: BRAND.dateModified,
      },
      faqSchema(LOGIN_FAQ),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Sign In', url: `${BRAND.url}/login` },
      ),
    ],
  };
}

/** Register page: WebPage + FAQ + BreadcrumbList */
export function registerSchema() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: 'Create Your Builderforce.ai Account',
        description:
          'Create a free account. Build, train, and deploy AI agents with WebGPU LoRA fine-tuning. No credit card required.',
        url: `${BRAND.url}/register`,
        dateModified: BRAND.dateModified,
      },
      faqSchema(REGISTER_FAQ),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Create Account', url: `${BRAND.url}/register` },
      ),
    ],
  };
}


/* ════════ Programmatic SEO — competitor & integration leaf pages ════════ */

/**
 * Per-competitor `/compare/{slug}` JSON-LD: a WebPage scoped to the rivalry, the
 * Builderforce SoftwareApplication entity, the competitor-intent FAQ, and a
 * breadcrumb trail. Mirrors `compareSchema()` but narrowed to a single rival so
 * each leaf page carries its own structured data.
 */
export function competitorCompareSchema(seo: CompetitorSeo) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: `Builderforce.ai vs ${seo.name}`,
        description: seo.summary,
        url: `${BRAND.url}/compare/${seo.slug}`,
        dateModified: BRAND.dateModified,
        about: { '@type': 'Thing', name: seo.name },
      },
      {
        '@type': 'SoftwareApplication',
        name: BRAND.name,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web, Self-hosted',
        description: seo.verdict,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      faqSchema(COMPARE_FAQ),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Compare', url: `${BRAND.url}/compare` },
        { name: `vs ${seo.name}`, url: `${BRAND.url}/compare/${seo.slug}` },
      ),
    ],
  };
}

/**
 * Per-integration `/integrations/{slug}` JSON-LD: a WebPage describing the
 * integration plus the Builderforce SoftwareApplication entity and a breadcrumb.
 */
export function integrationSchema(seo: IntegrationSeo) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: `Builderforce.ai + ${seo.name} integration`,
        description: seo.summary,
        url: `${BRAND.url}/integrations/${seo.slug}`,
        dateModified: BRAND.dateModified,
        about: { '@type': 'Thing', name: seo.name },
      },
      {
        '@type': 'SoftwareApplication',
        name: BRAND.name,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web, Self-hosted',
        description: seo.tagline,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Integrations', url: `${BRAND.url}/integrations` },
        { name: seo.name, url: `${BRAND.url}/integrations/${seo.slug}` },
      ),
    ],
  };
}

/** Standalone BreadcrumbList graph for simple index/leaf pages. */
export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return { '@context': 'https://schema.org', '@graph': [breadcrumbs(...items)] };
}

/**
 * JSON-LD for a logged-out feature route teaser (RouteMarketing): the
 * Builderforce SoftwareApplication scoped to that feature, an optional FAQPage,
 * and a breadcrumb. Gives the per-feature marketing pages (/brainstorm,
 * /training, /ide, …) real structured data for SEO/GEO even though they render
 * client-side. `path` is the route (e.g. '/brainstorm').
 */
export function routeMarketingSchema(opts: {
  path: string;
  title: string;
  description: string;
  faq?: FaqItem[];
}) {
  const url = `${BRAND.url}${opts.path}`;
  const graph: object[] = [
    organization,
    {
      '@type': 'SoftwareApplication',
      name: `${BRAND.name} — ${opts.title}`,
      description: opts.description,
      url,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web, Self-hosted',
      author: { '@id': `${BRAND.url}/#organization` },
      dateModified: BRAND.dateModified,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ];
  if (opts.faq && opts.faq.length) graph.push(faqSchema(opts.faq));
  graph.push(
    breadcrumbs(
      { name: 'Home', url: BRAND.url },
      { name: opts.title, url },
    ),
  );
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Individual published marketplace skill detail (`/marketplace/[slug]`). */
export function marketplaceSkillSchema(skill: {
  name: string;
  slug: string;
  description: string;
  category?: string | null;
  author_display_name?: string | null;
  tags?: string[];
}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: skill.name,
        description: skill.description,
        applicationCategory: skill.category || 'BusinessApplication',
        url: `${BRAND.url}/marketplace/${skill.slug}`,
        operatingSystem: 'Web, Self-hosted',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        ...(skill.author_display_name ? { author: { '@type': 'Person', name: skill.author_display_name } } : {}),
        ...(skill.tags && skill.tags.length ? { keywords: skill.tags.join(', ') } : {}),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Marketplace', url: `${BRAND.url}/marketplace` },
        { name: skill.name, url: `${BRAND.url}/marketplace/${skill.slug}` },
      ),
    ],
  };
}
