/**
 * JSON-LD structured data builders for SEO/GEO.
 *
 * Each function returns a plain object suitable for JSON.stringify()
 * inside a <script type="application/ld+json"> tag.
 */

import {
  BRAND,
  STATS,
  HOMEPAGE_FAQ,
  PRICING_FAQ,
  LOGIN_FAQ,
  REGISTER_FAQ,
  BLOG_FAQ,
  COMPARE_FAQ,
  EVERMIND,
  EVERMIND_FAQ,
  COMPARE,
  FEATURES,
  DEFINED_TERMS,
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
          'A creative canvas where teams and AI agents design, build, review, and deliver websites, workflows, models, data stories, and products in one connected visual workspace.',
        url: BRAND.url,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Web',
        author: { '@id': `${BRAND.url}/#organization` },
        dateModified: BRAND.dateModified,
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
        // Emit every published post (the index has 40+; a former 20-item cap
        // dropped over half of them from the crawlable graph) [1596].
        numberOfItems: posts.length,
        itemListElement: posts.map((post, i) => ({
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

/** Talent marketplace: CollectionPage + an ItemList of for-hire freelancers. */
export function talentMarketplaceSchema(
  freelancers: { userId: string; displayName?: string | null; headline?: string | null; discipline?: string | null; skills?: string[] | null }[],
) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: 'Talent Marketplace',
        description: 'Hire vetted freelance developers, DBAs, designers and other specialists on Builderforce.ai — with résumés, skills and hourly rates.',
        url: `${BRAND.url}/marketplace?category=talent`,
        publisher: { '@id': `${BRAND.url}/#organization` },
      },
      {
        '@type': 'ItemList',
        itemListElement: freelancers.slice(0, 100).map((f, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Person',
            name: f.displayName ?? 'Freelancer',
            url: `${BRAND.url}/talent/${encodeURIComponent(f.userId)}`,
            ...(f.headline ? { description: f.headline } : {}),
            ...(f.discipline ? { jobTitle: f.discipline } : {}),
            ...(f.skills && f.skills.length > 0 ? { knowsAbout: f.skills.join(', ') } : {}),
          },
        })),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Talent', url: `${BRAND.url}/marketplace?category=talent` },
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

/** SOC 2 / System Audits page: SoftwareApplication + ItemList of the audit types + FAQ + BreadcrumbList */
export function soc2Schema() {
  const url = `${BRAND.url}/soc2`;
  const audits = [
    { name: 'SOC 2 Readiness Audit', description: 'Scans your repositories and controls against the SOC 2 Common Criteria (CC1–CC9) and produces a prioritized readiness report.' },
    { name: 'Architecture Analysis', description: 'Rates design-principle adherence (DRY, SOLID, DDD, patterns) across your codebase.' },
    { name: 'Quality Audit', description: 'Checks testing, CI, and build-integrity signals across your repositories.' },
    { name: 'Product Vision & Roadmap Audit', description: 'Measures product direction: objectives, key results, roadmap, and a documented vision.' },
    { name: 'Compliance Audit Agent', description: 'Reviews connected GitHub source for privacy, AI, marketing, minor-safety, transfer, and accessibility readiness across US federal/state, EU/EEA, UK, Canada, Brazil, and Australia requirements.' },
  ];
  const faq = [
    { question: 'Is the SOC 2 audit a certification?', answer: 'No. It is a readiness audit: an automated, evidence-backed report that maps your repositories and controls to the SOC 2 Common Criteria (CC1–CC9) and tells you exactly what to close before a formal Type I/II examination.' },
    { question: 'How does the audit run during signup?', answer: 'The onboarding wizard creates a project, connects your ticket system and repositories, then files a ticket for the security agent. The audit scores an instant report and dispatches the agent to open a remediation pull request. You are notified when the report is ready.' },
    { question: 'Which repositories can it scan?', answer: 'GitHub, GitLab, Bitbucket, and Azure DevOps — one or many per project. Tokens stay server-side; the audit reads the repository tree to derive its signals.' },
    { question: 'What other system audits are included?', answer: 'The same one-click flow runs Architecture, Quality, Product Vision & Roadmap, and a multi-jurisdiction Compliance Audit Agent — each producing a scored project report.' },
  ];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'SoftwareApplication',
        '@id': `${BRAND.url}/#soc2`,
        name: `${BRAND.name} System Audits — SOC 2, Architecture, Quality, Privacy`,
        description: 'Automated system-level audits that run during onboarding: SOC 2 readiness, architecture, quality, product vision, and privacy/data-law — each scored into a project report with an agent-opened remediation PR.',
        url,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        author: { '@id': `${BRAND.url}/#organization` },
        dateModified: BRAND.dateModified,
        featureList: audits.map((a) => a.name),
      },
      {
        '@type': 'ItemList',
        name: 'Builderforce system audits',
        itemListElement: audits.map((a, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: a.name,
          description: a.description,
          url,
        })),
      },
      faqSchema(faq),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'SOC 2 & System Audits', url },
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
        'Collaborative AI project workspaces — each with a Canvas Builder, files, assigned agents, and workflows. View projects as cards, a table, a calendar, or a Gantt timeline.',
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
  const features = FEATURES.map((feature) => feature.title);
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
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Web',
        author: { '@id': `${BRAND.url}/#organization` },
        dateModified: BRAND.dateModified,
        featureList: features,
      },
      {
        '@type': 'ItemList',
        name: 'Criteria for evaluating Builderforce.ai and adjacent AI tools',
        itemListElement: COMPARE.pillars.map((criterion, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: criterion.title,
          description: criterion.desc,
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
export function pricingSchema(pricing?: {
  currency: string;
  plans: Array<{ id: 'free' | 'pro' | 'teams'; name: string; monthly: number; minimumSeats: number; ctaHref: string }>;
}) {
  const offers = pricing?.plans.map((plan) => ({
    '@type': 'Offer',
    name: plan.name,
    price: String(plan.monthly),
    priceCurrency: pricing.currency,
    url: `${BRAND.url}${plan.ctaHref}`,
    ...(plan.minimumSeats > 1 ? { eligibleQuantity: { '@type': 'QuantitativeValue', minValue: plan.minimumSeats } } : {}),
  }));
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        name: BRAND.name,
        description: 'AI agent training platform with Free, Pro, and Teams plans.',
        url: `${BRAND.url}/pricing`,
        brand: { '@id': `${BRAND.url}/#organization` },
        ...(offers ? { offers } : {}),
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
        description: `A criteria-based guide for evaluating Builderforce.ai alongside ${seo.name}. Verify current vendor capabilities and pricing for decision-critical requirements.`,
        url: `${BRAND.url}/compare/${seo.slug}`,
        dateModified: BRAND.dateModified,
        about: { '@type': 'Thing', name: seo.name },
      },
      {
        '@type': 'SoftwareApplication',
        name: BRAND.name,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Web',
        description: STATS.quotable.creativeCanvas,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
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
 * /training, /create, …) real structured data for SEO/GEO even though they render
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

/**
 * The SoftwareApplication node for one skill, wherever it is rendered.
 *
 * A skill has TWO homes and the same node describes both: a published skill sits
 * at `/marketplace/<slug>`, while the shipped built-ins have no marketplace row
 * and sit at `/skills/<slug>`. Only the `url` and the breadcrumb trail differ,
 * which is exactly why this is one function and not two near-copies.
 */
function skillApplicationNode(skill: {
  name: string;
  description: string;
  url: string;
  category?: string | null;
  author?: string | null;
  tags?: string[];
  version?: string | null;
}) {
  return {
    '@type': 'SoftwareApplication',
    name: skill.name,
    description: skill.description,
    applicationCategory: skill.category || 'BusinessApplication',
    url: skill.url,
    operatingSystem: 'Web, Self-hosted',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    ...(skill.author ? { author: { '@type': 'Person', name: skill.author } } : {}),
    ...(skill.tags && skill.tags.length ? { keywords: skill.tags.join(', ') } : {}),
    ...(skill.version ? { softwareVersion: skill.version } : {}),
  };
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
  const url = `${BRAND.url}/marketplace/${skill.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      skillApplicationNode({
        name: skill.name,
        description: skill.description,
        url,
        category: skill.category,
        author: skill.author_display_name,
        tags: skill.tags,
      }),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Marketplace', url: `${BRAND.url}/marketplace` },
        { name: skill.name, url },
      ),
    ],
  };
}

/**
 * A skill on its own catalog page (`/skills/[slug]`).
 *
 * Used for the BUILT-IN skills, which are the ones whose canonical URL this is —
 * a marketplace-published skill rendered on this route canonicalises to
 * `/marketplace/<slug>` instead, so its structured data is emitted by
 * `marketplaceSkillSchema` under that URL and the two never compete.
 */
export function skillCatalogSchema(skill: {
  name: string;
  slug: string;
  description: string;
  category?: string | null;
  author?: string | null;
  tags?: string[];
  version?: string | null;
}) {
  const url = `${BRAND.url}/skills/${skill.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      skillApplicationNode({ ...skill, url }),
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Skills', url: `${BRAND.url}/skills` },
        { name: skill.name, url },
      ),
    ],
  };
}

/**
 * One published persona (`/personas/[slug]`).
 *
 * `CreativeWork`, not `SoftwareApplication`: a persona is not a program you run,
 * it is an authored specification of voice, perspective and decision style that
 * an agent is compiled against. Its behaviour fields ride as `about` terms so a
 * crawler can see what the persona actually IS rather than only its blurb.
 */
export function personaDetailSchema(persona: {
  name: string;
  slug: string;
  description: string;
  category?: string | null;
  tags?: string[];
  voice?: string;
  perspective?: string;
  decisionStyle?: string;
  capabilities?: string[];
  authorName?: string | null;
  installCount?: number | null;
  updatedAt?: string | null;
}) {
  const url = `${BRAND.url}/personas/${persona.slug}`;
  const traits = [
    persona.voice ? { name: 'Voice', value: persona.voice } : null,
    persona.perspective ? { name: 'Perspective', value: persona.perspective } : null,
    persona.decisionStyle ? { name: 'Decision style', value: persona.decisionStyle } : null,
  ].filter((t): t is { name: string; value: string } => t !== null);
  const keywords = [...(persona.tags ?? []), ...(persona.capabilities ?? [])];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CreativeWork',
        name: persona.name,
        description: persona.description,
        url,
        genre: persona.category || 'AI agent persona',
        inLanguage: 'en',
        isPartOf: { '@type': 'CollectionPage', name: 'Builderforce.ai Personas', url: `${BRAND.url}/personas` },
        publisher: { '@id': `${BRAND.url}/#organization` },
        ...(persona.authorName ? { author: { '@type': 'Person', name: persona.authorName } } : {}),
        ...(keywords.length ? { keywords: keywords.join(', ') } : {}),
        ...(persona.updatedAt ? { dateModified: persona.updatedAt } : {}),
        ...(traits.length
          ? {
              additionalProperty: traits.map((t) => ({
                '@type': 'PropertyValue',
                name: t.name,
                value: t.value,
              })),
            }
          : {}),
        ...(typeof persona.installCount === 'number'
          ? {
              interactionStatistic: {
                '@type': 'InteractionCounter',
                interactionType: 'https://schema.org/InstallAction',
                userInteractionCount: persona.installCount,
              },
            }
          : {}),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Personas', url: `${BRAND.url}/personas` },
        { name: persona.name, url },
      ),
    ],
  };
}

/**
 * One public prompt (`/prompts/[slug]`).
 *
 * `CreativeWork` again, and `text` carries the prompt body itself — the prompt IS
 * the content of this page, so a graph that described it without including it
 * would be describing the wrapper.
 */
export function promptDetailSchema(prompt: {
  title: string;
  slug: string;
  description: string;
  body?: string;
  category?: string | null;
  tags?: string[];
  authorName?: string | null;
  currentVersion?: number | null;
  usageCount?: number | null;
  model?: string | null;
  updatedAt?: string | null;
}) {
  const url = `${BRAND.url}/prompts/${prompt.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CreativeWork',
        name: prompt.title,
        description: prompt.description,
        url,
        genre: prompt.category || 'AI prompt template',
        inLanguage: 'en',
        isPartOf: { '@type': 'CollectionPage', name: 'Builderforce.ai Prompt Library', url: `${BRAND.url}/prompts` },
        publisher: { '@id': `${BRAND.url}/#organization` },
        ...(prompt.body ? { text: prompt.body } : {}),
        ...(prompt.authorName ? { author: { '@type': 'Person', name: prompt.authorName } } : {}),
        ...(prompt.tags && prompt.tags.length ? { keywords: prompt.tags.join(', ') } : {}),
        ...(prompt.currentVersion ? { version: String(prompt.currentVersion) } : {}),
        ...(prompt.updatedAt ? { dateModified: prompt.updatedAt } : {}),
        ...(prompt.model
          ? { isBasedOn: { '@type': 'CreativeWork', name: prompt.model } }
          : {}),
        ...(typeof prompt.usageCount === 'number'
          ? {
              interactionStatistic: {
                '@type': 'InteractionCounter',
                interactionType: 'https://schema.org/UseAction',
                userInteractionCount: prompt.usageCount,
              },
            }
          : {}),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Prompts', url: `${BRAND.url}/prompts` },
        { name: prompt.title, url },
      ),
    ],
  };
}

/**
 * One published workforce agent (`/marketplace/agent/[id]`).
 *
 * `SoftwareApplication` with a real `offers` block: unlike a skill, an agent can
 * be priced, and a marketplace listing that hides its price from the graph is
 * the one field a shopping crawler came for. Free agents still get an Offer at 0
 * so the node never has to be read as "price unknown".
 */
export function publishedAgentSchema(agent: {
  id: string;
  name: string;
  title?: string;
  bio?: string;
  skills?: string[];
  baseModel?: string | null;
  hireCount?: number | null;
  evalScore?: number | null;
  priceCents?: number | null;
  pricingModel?: string | null;
  priceUnit?: string | null;
  updatedAt?: string | null;
}) {
  const url = `${BRAND.url}/marketplace/agent/${agent.id}`;
  const cents = typeof agent.priceCents === 'number' ? agent.priceCents : 0;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: agent.name,
        description: agent.bio || agent.title || `${agent.name}, a published agent on the Builderforce.ai Workforce Registry.`,
        url,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, Self-hosted',
        provider: { '@id': `${BRAND.url}/#organization` },
        offers: {
          '@type': 'Offer',
          price: (cents / 100).toFixed(2),
          priceCurrency: 'USD',
          ...(agent.priceUnit ? { unitText: agent.priceUnit } : {}),
        },
        ...(agent.title ? { alternateName: agent.title } : {}),
        ...(agent.skills && agent.skills.length ? { keywords: agent.skills.join(', ') } : {}),
        ...(agent.baseModel ? { isBasedOn: { '@type': 'CreativeWork', name: agent.baseModel } } : {}),
        ...(agent.updatedAt ? { dateModified: agent.updatedAt } : {}),
        ...(typeof agent.hireCount === 'number'
          ? {
              interactionStatistic: {
                '@type': 'InteractionCounter',
                interactionType: 'https://schema.org/JoinAction',
                userInteractionCount: agent.hireCount,
              },
            }
          : {}),
      },
      breadcrumbs(
        { name: 'Home', url: BRAND.url },
        { name: 'Marketplace', url: `${BRAND.url}/marketplace` },
        { name: agent.name, url },
      ),
    ],
  };
}
