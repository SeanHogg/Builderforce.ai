import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
/*
 * Brand paths come from a GENERATED subset, not from `simple-icons` itself.
 *
 * That package is one 4.98 MiB module with no per-icon entry points. This page is a
 * server component, so Next resolves its CommonJS build, which cannot be tree-shaken —
 * importing 31 icons pulled all ~3,300 into a shared edge chunk (6.71 MiB, the largest
 * single thing in the Worker) and put the bundle over Cloudflare's 10 MiB limit.
 * `scripts/gen-brand-paths.mjs` regenerates the subset; only `.path` was ever read.
 */
import { BRAND_PATHS } from '../brandPaths';
import { type IntegrationItem } from './IntegrationGrid';
import IntegrationsView, { type IntegrationSection } from './IntegrationsView';
import type { CustomSvg, IconSpec } from '../BrandIcon';
import { LUCIDE } from '../lucideIcons';
import { pageMetadata } from '@/lib/seo';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agents.integrationsPage');
  return pageMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/agents/integrations' });
}

const si = (name: keyof typeof BRAND_PATHS): IconSpec => ({ kind: 'simple', path: BRAND_PATHS[name] });
const lc = (name: keyof typeof LUCIDE | string): IconSpec => ({ kind: 'lucide', svg: LUCIDE[name] ?? LUCIDE.bot });
const cs = (svg: CustomSvg): IconSpec => ({ kind: 'custom', svg });

const minimaxIcon: CustomSvg = {
  viewBox: '0 0 680 572',
  defs: {
    linearGradients: [{
      id: 'minimax-grad',
      x1: '0%', y1: '0%', x2: '100%', y2: '0%',
      stops: [
        { offset: '0%', color: '#e31e80' },
        { offset: '100%', color: '#fe6642' },
      ],
    }],
  },
  paths: [{ d: 'M 468 5 L 445 6 L 426 15 L 411 31 L 403 55 L 403 516 L 394 530 L 376 535 L 357 521 L 352 445 L 337 439 L 324 450 L 327 531 L 346 556 L 370 566 L 389 566 L 412 556 L 427 540 L 435 516 L 435 55 L 447 39 L 469 38 L 483 56 L 483 422 L 490 443 L 513 465 L 544 471 L 572 460 L 591 435 L 594 200 L 598 189 L 612 179 L 628 180 L 642 197 L 643 394 L 660 405 L 674 392 L 673 190 L 664 170 L 648 155 L 626 147 L 605 148 L 575 167 L 563 194 L 562 422 L 544 439 L 530 438 L 518 428 L 514 50 L 506 30 L 492 15 Z M 309 5 L 290 5 L 265 16 L 251 32 L 244 52 L 244 460 L 235 476 L 215 481 L 196 463 L 196 199 L 187 172 L 174 158 L 153 148 L 127 148 L 106 158 L 90 177 L 84 199 L 84 316 L 73 331 L 54 334 L 39 322 L 36 267 L 31 259 L 15 256 L 5 264 L 5 324 L 17 346 L 48 365 L 82 362 L 105 344 L 115 322 L 117 194 L 127 182 L 139 178 L 160 189 L 164 198 L 164 464 L 176 492 L 189 504 L 209 512 L 231 512 L 253 502 L 267 487 L 275 466 L 275 58 L 279 47 L 296 36 L 313 40 L 324 61 L 324 394 L 330 402 L 341 405 L 355 392 L 355 53 L 343 25 L 328 12 Z', fill: 'url(#minimax-grad)' }],
};

/**
 * An integration as this page DECLARES it: identity and presentation only.
 *
 * The one-line `desc` every card and table row shows is prose, so it is NOT here —
 * it lives in the catalogs at `agents.integrationsPage.items.<name>`, keyed by the
 * product name because that name is a trademark that never translates while the
 * sentence about it always does. Keyed rather than index-paired so inserting a row
 * cannot silently shift every description below it onto the wrong product.
 */
type IntegrationEntry = Omit<IntegrationItem, 'desc'>;

/** A section's identity: a stable id for its copy, plus the rows it lists. */
type SectionSpec = { id: string; items: IntegrationEntry[]; columns?: 2 | 3 | 4 };

const SECTIONS: SectionSpec[] = [
  {
    id: 'chatProviders',
    items: [
      { name: 'WhatsApp', icon: si('siWhatsapp'), color: '#25D366', docs: '/agents/skills' },
      { name: 'Telegram', icon: si('siTelegram'), color: '#26A5E4', docs: '/docs/telegram' },
      { name: 'Discord', icon: si('siDiscord'), color: '#5865F2', docs: '/agents/skills/discord' },
      { name: 'Slack', icon: lc('hash'), color: '#E01E5A', docs: '/agents/skills/slack' },
      { name: 'Signal', icon: si('siSignal'), color: '#3A76F0', docs: '/docs/channels/signal' },
      { name: 'iMessage', icon: si('siApple'), color: '#007AFF', docs: 'https://github.com/steipete/imsg' },
      { name: 'Microsoft Teams', icon: lc('users'), color: '#6264A7', docs: '/docs/channels/msteams' },
      { name: 'Nextcloud Talk', icon: si('siNextcloud'), color: '#0082C9', docs: '/docs/channels/nextcloud-talk' },
      { name: 'Matrix', icon: si('siMatrix'), color: '#000000', docs: '/docs/channels/matrix' },
      { name: 'Nostr', icon: lc('message-circle'), color: '#8F2CFF', docs: '/docs/channels/nostr' },
      { name: 'Zalo', icon: si('siZalo'), color: '#0068FF', docs: '/docs/channels/zalo' },
      { name: 'WebChat', icon: lc('globe'), color: 'var(--cyan-bright)', docs: '/docs/webchat' },
    ],
  },
  {
    id: 'models',
    items: [
      { name: 'Anthropic', icon: si('siAnthropic'), color: '#D4A574', docs: '/docs/models' },
      { name: 'OpenAI', icon: lc('bot'), color: '#00A67E', docs: '/docs/models' },
      { name: 'Google', icon: si('siGoogle'), color: '#4285F4', docs: '/docs/models' },
      { name: 'MiniMax', icon: cs(minimaxIcon), color: '#E91E63', docs: '/docs/providers/minimax' },
      { name: 'xAI', icon: si('siX'), color: 'var(--text-on-accent)', docs: '/docs/models' },
      { name: 'Vercel AI Gateway', icon: si('siVercel'), color: 'var(--text-on-accent)', docs: '/docs/providers/vercel-ai-gateway' },
      { name: 'OpenRouter', icon: lc('zap'), color: '#6366F1', docs: '/docs/models' },
      { name: 'Mistral', icon: si('siMistralai'), color: '#FF7000', docs: '/docs/models' },
      { name: 'DeepSeek', icon: lc('brain'), color: '#4D6BFE', docs: '/docs/models' },
      { name: 'Perplexity', icon: si('siPerplexity'), color: '#20B8CD', docs: '/docs/models' },
      { name: 'Hugging Face', icon: si('siHuggingface'), color: '#FFD21E', docs: '/docs/models' },
      { name: 'Local Models', icon: si('siOllama'), color: 'var(--text-on-accent)', docs: '/docs/models' },
    ],
  },
  {
    id: 'productivity',
    items: [
      { name: 'Apple Notes', icon: lc('sticky-note'), color: '#FFCC00', docs: '/agents/skills' },
      { name: 'Apple Reminders', icon: lc('check-square'), color: '#FF9500', docs: '/agents/skills' },
      { name: 'Things 3', icon: lc('list-todo'), color: '#4A90D9', docs: '/agents/skills' },
      { name: 'Notion', icon: si('siNotion'), color: 'var(--text-on-accent)', docs: '/agents/skills' },
      { name: 'Obsidian', icon: si('siObsidian'), color: '#7C3AED', docs: '/agents/skills/obsidian' },
      { name: 'Bear Notes', icon: lc('pen-tool'), color: '#DD4C4F', docs: '/agents/skills' },
      { name: 'Trello', icon: si('siTrello'), color: '#0079BF', docs: '/agents/skills/trello' },
      { name: 'GitHub', icon: si('siGithub'), color: 'var(--text-on-accent)', docs: '/agents/skills' },
    ],
  },
  {
    id: 'musicAudio',
    columns: 3,
    items: [
      { name: 'Spotify', icon: si('siSpotify'), color: '#1DB954', docs: '/agents/skills/spotify-player' },
      { name: 'Sonos', icon: si('siSonos'), color: 'var(--text-on-accent)', docs: '/agents/skills' },
      { name: 'Shazam', icon: si('siShazam'), color: '#0088FF', docs: '/agents/skills' },
    ],
  },
  {
    id: 'smartHome',
    columns: 3,
    items: [
      { name: 'Philips Hue', icon: si('siPhilipshue'), color: '#0065D3', docs: '/agents/skills/openhue' },
      { name: '8Sleep', icon: lc('bed'), color: '#00B4D8', docs: '/agents/skills' },
      { name: 'Home Assistant', icon: si('siHomeassistant'), color: '#41BDF5', docs: '/agents/skills' },
    ],
  },
  {
    id: 'tools',
    items: [
      { name: 'Browser', icon: si('siGooglechrome'), color: '#4285F4', docs: '/agents/skills' },
      { name: 'Canvas', icon: lc('monitor-smartphone'), color: '#FF4500', docs: '/docs/mac/canvas' },
      { name: 'Voice', icon: lc('mic'), color: '#9B59B6', docs: '/agents/skills/voice-call' },
      { name: 'Gmail', icon: si('siGmail'), color: '#EA4335', docs: '/docs/gmail-pubsub' },
      { name: 'Cron', icon: lc('clock'), color: '#F39C12', docs: '/docs/cron' },
      { name: 'Webhooks', icon: lc('webhook'), color: '#1ABC9C', docs: '/docs/webhook' },
      { name: '1Password', icon: si('si1password'), color: '#0572EC', docs: '/agents/skills/1password' },
      { name: 'Weather', icon: lc('cloud-sun'), color: '#FFB300', docs: '/agents/skills/weather' },
    ],
  },
  {
    id: 'mediaCreative',
    items: [
      { name: 'Image Gen', icon: lc('image'), color: '#E91E63', docs: '/agents/skills' },
      { name: 'GIF Search', icon: lc('search'), color: '#00DCDC', docs: '/agents/skills' },
      { name: 'Peekaboo', icon: lc('eye'), color: 'var(--red-bright)', docs: '/agents/skills' },
      { name: 'Camera', icon: lc('camera'), color: '#607D8B', docs: '/agents/skills' },
    ],
  },
  {
    id: 'social',
    columns: 2,
    items: [
      { name: 'Twitter/X', icon: si('siX'), color: 'var(--text-on-accent)', docs: '/agents/skills' },
      { name: 'Email', icon: lc('mail'), color: '#D44638', docs: '/agents/skills' },
    ],
  },
  {
    id: 'companionApps',
    items: [
      { name: 'macOS', icon: si('siMacos'), color: 'var(--text-on-accent)', docs: '/docs/macos' },
      { name: 'iOS', icon: si('siIos'), color: '#007AFF', docs: '/docs/ios' },
      { name: 'Android', icon: si('siAndroid'), color: '#34A853', docs: '/docs/android' },
      { name: 'Windows', icon: lc('monitor'), color: '#0078D4', docs: '/docs/windows' },
      { name: 'Linux', icon: si('siLinux'), color: '#FCC624', docs: '/docs/linux' },
    ],
  },
  {
    id: 'examples',
    items: [
      { name: 'Tesco Autopilot', icon: lc('shopping-cart'), color: '#00539F', docs: '/docs/start/showcase' },
      { name: 'Bambu Control', icon: lc('printer'), color: '#00AE42', docs: '/docs/start/showcase' },
      { name: 'Oura Ring', icon: lc('heart'), color: '#E4B363', docs: '/docs/start/showcase' },
      { name: 'Food Ordering', icon: lc('utensils-crossed'), color: '#FF5A5F', docs: '/docs/start/showcase' },
    ],
  },
];

export default async function IntegrationsPage() {
  const t = await getTranslations('agents.integrationsPage');
  const descriptions = t.raw('items') as Record<string, string>;

  const sections: IntegrationSection[] = SECTIONS.map((s) => ({
    title: t(`sections.${s.id}.title`),
    description: t(`sections.${s.id}.description`),
    items: s.items.map((item) => ({ ...item, desc: descriptions[item.name] })),
    ...(s.columns ? { columns: s.columns } : {}),
  }));

  return (
    <div className="cc-int-page">
      <header className="cc-int-hero">
        <h1 className="cc-int-title">{t('heading')}</h1>
        <p className="cc-int-lead">
          {t('leadLine1')}<br />
          {t('leadLine2')}
        </p>
      </header>

      <IntegrationsView sections={sections} />

      <style>{`
        .cc-int-page {
          max-width: 1100px;
          margin: 0 auto;
          padding: 56px 24px 80px;
        }
        .cc-int-hero {
          text-align: center;
          margin-bottom: 24px;
        }
        .cc-int-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: var(--font-size-page-title);
          margin: 0;
          color: var(--text-primary);
        }
        .cc-int-lead {
          color: var(--text-secondary);
          margin-top: 12px;
          line-height: 1.6;
        }
        .cc-agentHost-accent { color: var(--coral-bright); margin-right: 8px; }
      `}</style>
    </div>
  );
}
