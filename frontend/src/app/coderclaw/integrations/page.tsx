import type { Metadata } from 'next';
import {
  siWhatsapp, siTelegram, siDiscord, siSignal, siApple, siMatrix, siNextcloud, siZalo,
  siAnthropic, siGoogle, siOllama, siMistralai, siPerplexity, siHuggingface,
  siNotion, siObsidian, siTrello, siGithub,
  siSpotify, siSonos, siShazam,
  siPhilipshue, siHomeassistant,
  siGooglechrome, siGmail, si1password,
  siX, siVercel,
  siLinux, siAndroid, siMacos, siIos,
} from 'simple-icons';
import IntegrationGrid, { type IntegrationItem } from './IntegrationGrid';
import type { CustomSvg, IconSpec } from '../BrandIcon';
import { LUCIDE } from '../lucideIcons';

export const metadata: Metadata = {
  title: 'Integrations — CoderClaw',
  description:
    'CoderClaw integrates with your entire stack — WhatsApp, Telegram, Discord, GitHub, Gmail, Obsidian, and more. Connect your agents to the tools you already use.',
  alternates: { canonical: '/coderclaw/integrations' },
};

type SimpleIcon = { path: string };

const si = (icon: SimpleIcon): IconSpec => ({ kind: 'simple', path: icon.path });
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

const chatProviders: IntegrationItem[] = [
  { name: 'WhatsApp', icon: si(siWhatsapp), color: '#25D366', desc: 'QR pairing via Baileys', docs: 'https://coderclaw.ai/skills/wacli' },
  { name: 'Telegram', icon: si(siTelegram), color: '#26A5E4', desc: 'Bot API via grammY', docs: 'https://docs.coderclaw.ai/telegram' },
  { name: 'Discord', icon: si(siDiscord), color: '#5865F2', desc: 'Servers, channels & DMs', docs: 'https://coderclaw.ai/skills/discord' },
  { name: 'Slack', icon: lc('hash'), color: '#E01E5A', desc: 'Workspace apps via Bolt', docs: 'https://coderclaw.ai/skills/slack' },
  { name: 'Signal', icon: si(siSignal), color: '#3A76F0', desc: 'Privacy-focused via signal-cli', docs: 'https://docs.coderclaw.ai/channels/signal' },
  { name: 'iMessage', icon: si(siApple), color: '#007AFF', desc: 'iMessage via imsg (AppleScript bridge)', docs: 'https://github.com/steipete/imsg' },
  { name: 'Microsoft Teams', icon: lc('users'), color: '#6264A7', desc: 'Enterprise support', docs: 'https://docs.coderclaw.ai/channels/msteams' },
  { name: 'Nextcloud Talk', icon: si(siNextcloud), color: '#0082C9', desc: 'Self-hosted Nextcloud chat', docs: 'https://docs.coderclaw.ai/channels/nextcloud-talk' },
  { name: 'Matrix', icon: si(siMatrix), color: '#000000', desc: 'Matrix protocol', docs: 'https://docs.coderclaw.ai/channels/matrix' },
  { name: 'Nostr', icon: lc('message-circle'), color: '#8F2CFF', desc: 'Decentralized DMs via NIP-04', docs: 'https://docs.coderclaw.ai/channels/nostr' },
  { name: 'Zalo', icon: si(siZalo), color: '#0068FF', desc: 'Zalo Bot API', docs: 'https://docs.coderclaw.ai/channels/zalo' },
  { name: 'WebChat', icon: lc('globe'), color: '#00E5CC', desc: 'Browser-based UI', docs: 'https://docs.coderclaw.ai/webchat' },
];

const modelProviders: IntegrationItem[] = [
  { name: 'Anthropic', icon: si(siAnthropic), color: '#D4A574', desc: 'Claude Pro/Max + Opus 4.5', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'OpenAI', icon: lc('bot'), color: '#00A67E', desc: 'GPT-4, GPT-5, o1', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'Google', icon: si(siGoogle), color: '#4285F4', desc: 'Gemini 2.5 Pro/Flash', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'MiniMax', icon: cs(minimaxIcon), color: '#E91E63', desc: 'MiniMax-M2.1', docs: 'https://docs.coderclaw.ai/providers/minimax' },
  { name: 'xAI', icon: si(siX), color: '#FFFFFF', desc: 'Grok 3 & 4', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'Vercel AI Gateway', icon: si(siVercel), color: '#FFFFFF', desc: 'Hundreds of models, 1 API key', docs: 'https://docs.coderclaw.ai/providers/vercel-ai-gateway' },
  { name: 'OpenRouter', icon: lc('zap'), color: '#6366F1', desc: 'Unified API gateway', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'Mistral', icon: si(siMistralai), color: '#FF7000', desc: 'Mistral Large & Codestral', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'DeepSeek', icon: lc('brain'), color: '#4D6BFE', desc: 'DeepSeek V3 & R1', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'Perplexity', icon: si(siPerplexity), color: '#20B8CD', desc: 'Search-augmented AI', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'Hugging Face', icon: si(siHuggingface), color: '#FFD21E', desc: 'Open-source models', docs: 'https://docs.coderclaw.ai/models' },
  { name: 'Local Models', icon: si(siOllama), color: '#FFFFFF', desc: 'Ollama, LM Studio', docs: 'https://docs.coderclaw.ai/models' },
];

const productivityApps: IntegrationItem[] = [
  { name: 'Apple Notes', icon: lc('sticky-note'), color: '#FFCC00', desc: 'Native macOS/iOS notes', docs: 'https://coderclaw.ai/skills/apple-notes' },
  { name: 'Apple Reminders', icon: lc('check-square'), color: '#FF9500', desc: 'Task management', docs: 'https://coderclaw.ai/skills/apple-reminders' },
  { name: 'Things 3', icon: lc('list-todo'), color: '#4A90D9', desc: 'GTD task manager', docs: 'https://coderclaw.ai/skills/things-mac' },
  { name: 'Notion', icon: si(siNotion), color: '#FFFFFF', desc: 'Workspace & databases', docs: 'https://coderclaw.ai/skills' },
  { name: 'Obsidian', icon: si(siObsidian), color: '#7C3AED', desc: 'Knowledge graph notes', docs: 'https://coderclaw.ai/skills/obsidian' },
  { name: 'Bear Notes', icon: lc('pen-tool'), color: '#DD4C4F', desc: 'Markdown notes', docs: 'https://coderclaw.ai/skills' },
  { name: 'Trello', icon: si(siTrello), color: '#0079BF', desc: 'Kanban boards', docs: 'https://coderclaw.ai/skills/trello' },
  { name: 'GitHub', icon: si(siGithub), color: '#FFFFFF', desc: 'Code, issues, PRs', docs: 'https://coderclaw.ai/skills' },
];

const musicAudio: IntegrationItem[] = [
  { name: 'Spotify', icon: si(siSpotify), color: '#1DB954', desc: 'Music playback control', docs: 'https://coderclaw.ai/skills/spotify-player' },
  { name: 'Sonos', icon: si(siSonos), color: '#FFFFFF', desc: 'Multi-room audio', docs: 'https://coderclaw.ai/skills/sonoscli' },
  { name: 'Shazam', icon: si(siShazam), color: '#0088FF', desc: 'Song recognition', docs: 'https://coderclaw.ai/skills/songsee' },
];

const smartHome: IntegrationItem[] = [
  { name: 'Philips Hue', icon: si(siPhilipshue), color: '#0065D3', desc: 'Smart lighting', docs: 'https://coderclaw.ai/skills/openhue' },
  { name: '8Sleep', icon: lc('bed'), color: '#00B4D8', desc: 'Smart mattress', docs: 'https://coderclaw.ai/skills/eightctl' },
  { name: 'Home Assistant', icon: si(siHomeassistant), color: '#41BDF5', desc: 'Home automation hub', docs: 'https://coderclaw.ai/skills/homeassistant' },
];

const tools: IntegrationItem[] = [
  { name: 'Browser', icon: si(siGooglechrome), color: '#4285F4', desc: 'Chrome/Chromium control', docs: 'https://coderclaw.ai/skills/verify-on-browser' },
  { name: 'Canvas', icon: lc('monitor-smartphone'), color: '#FF4500', desc: 'Visual workspace + A2UI', docs: 'https://docs.coderclaw.ai/mac/canvas' },
  { name: 'Voice', icon: lc('mic'), color: '#9B59B6', desc: 'Voice Wake + Talk Mode', docs: 'https://coderclaw.ai/skills/voice-transcribe' },
  { name: 'Gmail', icon: si(siGmail), color: '#EA4335', desc: 'Pub/Sub email triggers', docs: 'https://docs.coderclaw.ai/gmail-pubsub' },
  { name: 'Cron', icon: lc('clock'), color: '#F39C12', desc: 'Scheduled tasks', docs: 'https://docs.coderclaw.ai/cron' },
  { name: 'Webhooks', icon: lc('webhook'), color: '#1ABC9C', desc: 'External triggers', docs: 'https://docs.coderclaw.ai/webhook' },
  { name: '1Password', icon: si(si1password), color: '#0572EC', desc: 'Secure credentials', docs: 'https://coderclaw.ai/skills/1password' },
  { name: 'Weather', icon: lc('cloud-sun'), color: '#FFB300', desc: 'Forecasts & conditions', docs: 'https://coderclaw.ai/skills/weather' },
];

const mediaCreative: IntegrationItem[] = [
  { name: 'Image Gen', icon: lc('image'), color: '#E91E63', desc: 'AI image generation', docs: 'https://coderclaw.ai/skills' },
  { name: 'GIF Search', icon: lc('search'), color: '#00DCDC', desc: 'Find the perfect GIF', docs: 'https://coderclaw.ai/skills/gifgrep' },
  { name: 'Peekaboo', icon: lc('eye'), color: '#FF6B6B', desc: 'Screen capture & control', docs: 'https://coderclaw.ai/skills/peekaboo' },
  { name: 'Camera', icon: lc('camera'), color: '#607D8B', desc: 'Photo/video capture', docs: 'https://coderclaw.ai/skills' },
];

const socialComms: IntegrationItem[] = [
  { name: 'Twitter/X', icon: si(siX), color: '#FFFFFF', desc: 'Tweet, reply, search', docs: 'https://coderclaw.ai/skills/bird' },
  { name: 'Email', icon: lc('mail'), color: '#D44638', desc: 'Send & read emails', docs: 'https://coderclaw.ai/skills/himalaya' },
];

const companionApps: IntegrationItem[] = [
  { name: 'macOS', icon: si(siMacos), color: '#FFFFFF', desc: 'Menu bar app + Voice Wake', docs: 'https://docs.coderclaw.ai/macos' },
  { name: 'iOS', icon: si(siIos), color: '#007AFF', desc: 'Canvas, camera, Voice Wake', docs: 'https://docs.coderclaw.ai/ios' },
  { name: 'Android', icon: si(siAndroid), color: '#34A853', desc: 'Canvas, camera, screen', docs: 'https://docs.coderclaw.ai/android' },
  { name: 'Windows', icon: lc('monitor'), color: '#0078D4', desc: 'WSL2 recommended', docs: 'https://docs.coderclaw.ai/windows' },
  { name: 'Linux', icon: si(siLinux), color: '#FCC624', desc: 'Native support', docs: 'https://docs.coderclaw.ai/linux' },
];

const showcaseItems: IntegrationItem[] = [
  { name: 'Tesco Autopilot', icon: lc('shopping-cart'), color: '#00539F', desc: 'Automated grocery shopping', docs: 'https://docs.coderclaw.ai/start/showcase' },
  { name: 'Bambu Control', icon: lc('printer'), color: '#00AE42', desc: '3D printer management', docs: 'https://docs.coderclaw.ai/start/showcase' },
  { name: 'Oura Ring', icon: lc('heart'), color: '#E4B363', desc: 'Health data insights', docs: 'https://docs.coderclaw.ai/start/showcase' },
  { name: 'Food Ordering', icon: lc('utensils-crossed'), color: '#FF5A5F', desc: 'Foodora integration', docs: 'https://docs.coderclaw.ai/start/showcase' },
];

export default function IntegrationsPage() {
  return (
    <div className="cc-int-page">
      <header className="cc-int-hero">
        <h1 className="cc-int-title">Integrations</h1>
        <p className="cc-int-lead">
          50+ integrations with the apps and services you already use.<br />
          Chat from your phone, control from your desktop, automate everything.
        </p>
      </header>

      <IntegrationGrid title="Chat Providers" description="Message CoderClaw from any chat app — it responds right where you are." items={chatProviders} />
      <IntegrationGrid title="AI Models" description="Use any model you want — cloud or local. Your keys, your choice." items={modelProviders} />
      <IntegrationGrid title="Productivity" description="Notes, tasks, wikis, and code — CoderClaw works with your favorite tools." items={productivityApps} />
      <IntegrationGrid title="Music & Audio" description="Control playback, identify songs, and manage multi-room audio." items={musicAudio} columns={3} />
      <IntegrationGrid title="Smart Home" description="Lights, thermostats, and IoT devices — all voice-controllable." items={smartHome} columns={3} />
      <IntegrationGrid title="Tools & Automation" description="Browser control, scheduled tasks, email triggers, and more." items={tools} />
      <IntegrationGrid title="Media & Creative" description="Generate images, capture screens, and find the perfect GIF." items={mediaCreative} />
      <IntegrationGrid title="Social" description="Post tweets, manage email, and stay connected." items={socialComms} columns={2} />
      <IntegrationGrid title="Companion Apps" description="Native apps and platform support across your devices." items={companionApps} />
      <IntegrationGrid title="Real-World Examples" description="What people are actually building with CoderClaw integrations." items={showcaseItems} />

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
          font-size: clamp(2rem, 5vw, 3rem);
          margin: 0;
          color: var(--text-primary);
        }
        .cc-int-lead {
          color: var(--text-secondary);
          margin-top: 12px;
          line-height: 1.6;
        }
        .cc-claw-accent { color: var(--coral-bright); margin-right: 8px; }
      `}</style>
    </div>
  );
}
