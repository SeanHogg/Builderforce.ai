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
  DEFINED_TERMS,
  PRICING_PLANS,
  type FaqItem,
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
          'AI agent training platform. Build, train, and deploy custom AI agents with WebGPU LoRA fine-tuning in the browser, skills marketplace, personas, and publish to the Workforce Registry.',
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
