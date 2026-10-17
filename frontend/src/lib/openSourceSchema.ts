/**
 * JSON-LD for `/open-source` and `/open-source/{slug}` — a projection of the
 * open-source registry, in the page's language.
 */

import { BRAND } from './content/brand';
import type { CopyReader } from './content/copy';
import { OPEN_SOURCE_PACKAGES, openSourcePath, type OpenSourcePackage } from './openSourcePackages';
import { breadcrumbs, homeCrumb, organization } from './structuredDataParts';

/** One registry row as a schema.org SoftwareSourceCode entity, in the page's language. */
function softwareSourceCode(t: CopyReader, entry: OpenSourcePackage) {
  return {
    '@type': 'SoftwareSourceCode',
    name: entry.displayName,
    description: t(`openSource.packages.${entry.key}.summary`),
    url: `${BRAND.url}${openSourcePath(entry)}`,
    codeRepository: entry.repoUrl,
    programmingLanguage: entry.language,
    license: `https://spdx.org/licenses/${entry.license}.html`,
    author: { '@id': `${BRAND.url}/#organization` },
  };
}

/** The "Open source" crumb both open-source pages share. */
const openSourceCrumb = (t: CopyReader) => ({ name: t('openSource.hero.eyebrow'), url: `${BRAND.url}/open-source` });

/**
 * `/open-source` JSON-LD: a CollectionPage whose ItemList is every registry row
 * as SoftwareSourceCode, the Organization they are published by, and a
 * breadcrumb. A projection of `OPEN_SOURCE_PACKAGES`, so a new row appears here
 * with no edit.
 */
export function openSourceIndexSchema(t: CopyReader) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'CollectionPage',
        name: t('openSource.seo.title'),
        description: t('openSource.seo.description'),
        url: `${BRAND.url}/open-source`,
        dateModified: BRAND.dateModified,
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: OPEN_SOURCE_PACKAGES.map((entry, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: softwareSourceCode(t, entry),
          })),
        },
      },
      breadcrumbs(homeCrumb(t), openSourceCrumb(t)),
    ],
  };
}

/** `/open-source/{slug}` JSON-LD: the package as SoftwareSourceCode plus a breadcrumb. */
export function openSourcePackageSchema(t: CopyReader, entry: OpenSourcePackage) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      softwareSourceCode(t, entry),
      breadcrumbs(
        homeCrumb(t),
        openSourceCrumb(t),
        { name: entry.displayName, url: `${BRAND.url}${openSourcePath(entry)}` },
      ),
    ],
  };
}
