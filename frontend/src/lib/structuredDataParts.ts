/**
 * The shared pieces every JSON-LD graph is assembled from — the FAQ and breadcrumb
 * shapes, the localized "Home" crumb, and the Organization / author nodes. Split out of
 * `structured-data.ts` so per-area builders (e.g. {@link ./openSourceSchema}) compose
 * the SAME nodes instead of restating them.
 */

import { BRAND } from './content/brand';
import { contentKey, type CopyReader } from './content/copy';
import type { FaqItem } from './content/faq';

export function faqSchema(items: FaqItem[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  };
}

export function breadcrumbs(...items: { name: string; url: string }[]) {
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

/** A `marketing.content.schema.*` string. */
export const schemaCopy = (t: CopyReader, path: string, values?: Record<string, string | number>) =>
  t(contentKey(`schema.${path}`), values);

/** The localized "Home" crumb every marketing trail starts from. */
export const homeCrumb = (t: CopyReader) => ({ name: schemaCopy(t, 'crumb.home'), url: BRAND.url });

/** An absolute URL for a site path; an already-absolute href passes through. */
export const absoluteUrl = (href: string) => (/^https?:\/\//.test(href) ? href : `${BRAND.url}${href}`);

export const organization = {
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

export const authorPerson = {
  '@type': 'Person',
  name: BRAND.founder.name,
  url: BRAND.founder.url,
  jobTitle: 'Founder',
  worksFor: { '@type': 'Organization', name: BRAND.legalName },
};
