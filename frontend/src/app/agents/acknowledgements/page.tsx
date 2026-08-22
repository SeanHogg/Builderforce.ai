import { Icon } from '@/components/ui/Icon';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import ProsePage from '../ProsePage';
import { BRAND } from '@/lib/content';
import { pageMetadata } from '@/lib/seo';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agents.acknowledgements');
  return pageMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/agents/acknowledgements' });
}

/**
 * The packages we lean on: NAME and URL only.
 *
 * The one-line description of each is prose, so it lives in the catalogs keyed by
 * package name (`agents.acknowledgements.packages.<name>`) rather than here — the
 * package name is an identifier and never translates, the sentence about it always
 * does. Keyed rather than index-paired so adding a package cannot silently shift
 * every description below it onto the wrong row.
 */
const PACKAGES: { name: string; url: string }[] = [
  { name: 'lit', url: 'https://lit.dev' },
  { name: '@agentclientprotocol/sdk', url: 'https://github.com/agentclientprotocol' },
  { name: 'typescript', url: 'https://www.typescriptlang.org' },
  { name: 'zod', url: 'https://zod.dev' },
  { name: 'express', url: 'https://expressjs.com' },
  { name: 'ws', url: 'https://github.com/websockets/ws' },
  { name: 'yaml', url: 'https://eemeli.org/yaml/' },
  { name: 'playwright-core', url: 'https://playwright.dev' },
  { name: 'sharp', url: 'https://sharp.pixelplumbing.com' },
  { name: 'croner', url: 'https://github.com/hexagon/croner' },
  { name: 'commander', url: 'https://github.com/tj/commander.js' },
  { name: 'undici', url: 'https://undici.nodejs.org' },
  { name: 'vitest', url: 'https://vitest.dev' },
  { name: 'pdfjs-dist', url: 'https://mozilla.github.io/pdf.js/' },
  { name: '@sinclair/typebox', url: 'https://github.com/sinclairzx81/typebox' },
  { name: '@slack/bolt', url: 'https://slack.dev/bolt-js/' },
  { name: 'grammy', url: 'https://grammy.dev' },
  { name: 'markdown-it', url: 'https://markdown-it.github.io' },
  { name: 'astro', url: 'https://astro.build' },
  { name: 'drizzle-orm', url: 'https://orm.drizzle.team' },
  { name: 'hono', url: 'https://hono.dev' },
];

type Difference = { title: string; body: string };

export default async function AcknowledgementsPage() {
  const t = await getTranslations('agents.acknowledgements');
  const differences = t.raw('differences') as Difference[];
  const packageDescriptions = t.raw('packages') as Record<string, string>;

  return (
    <ProsePage width="wide">
      <h1>{t('heading')}</h1>
      <p className="lead">{t('lead')}</p>

      <section>
        <h2>{t('originHeading')}</h2>
        <p>
          {t('originIntroBefore')}{' '}
          <a href="https://openclaw.ai" target="_blank" rel="noopener">OpenClaw</a>
          {t('originIntroAfter')}
        </p>
        <p>
          <strong>{t('thankYou')}</strong>{' '}
          {t('thanksBefore')}{' '}
          <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener">github.com/openclaw/openclaw</a>{' '}
          {t('thanksAfter')}
        </p>
      </section>

      <section>
        <h2>{t('extendsHeading')} <Icon source="🚀" size="1em" /></h2>
        <p>{t('extendsIntro')}</p>
        <ul>
          {differences.map((d) => (
            <li key={d.title}>
              <strong>{d.title}:</strong> {d.body}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('getStartedHeading')} <Icon source="📦" size="1em" /></h2>
        <p>{t('nodeRequirement')}</p>
        <pre><code>{`# ${t('installComment')}
npm install -g @seanhogg/builderforce-agents@latest

# ${t('pnpmComment')}
pnpm add -g @seanhogg/builderforce-agents@latest

# ${t('onboardComment')}
builderforce onboard --install-daemon`}</code></pre>
      </section>

      <section>
        <h2>{t('packagesHeading')} <Icon source="📚" size="1em" /></h2>
        <p>{t('packagesIntro')}</p>
        <ul>
          {PACKAGES.map((p) => (
            <li key={p.name}>
              <a href={p.url} target="_blank" rel="noopener"><code>{p.name}</code></a> — {packageDescriptions[p.name]}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('builtByHeading')} <Icon source="👤" size="1em" /></h2>
        <p>
          {/* The résumé is published on this platform — `/talent/<slug>` renders it —
              so this is an in-app route, not a link out to another host. */}
          <Link href={BRAND.founder.path}>{BRAND.founder.name}</Link> — {t('founderRole')}{' '}
          <a href="https://github.com/SeanHogg" target="_blank" rel="noopener">GitHub</a> ·{' '}
          <Link href="/agents/contact">{t('contactLabel')}</Link>
        </p>
      </section>

      <section>
        <h2>{t('licenseHeading')} <Icon source="⚖️" size="1em" /></h2>
        <p>
          {t('licenseBefore')}{' '}
          <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener">{t('mitLicense')}</a>
          {t('licenseAfter')}
        </p>
      </section>
    </ProsePage>
  );
}
