import type { Metadata } from 'next';
import ProsePage from '../ProsePage';

export const metadata: Metadata = {
  title: 'Acknowledgements — CoderClaw',
  description: "CoderClaw's roots, key open-source packages, and the people who made it possible.",
  alternates: { canonical: '/coderclaw/acknowledgements' },
};

const packages = [
  { name: 'lit', desc: 'Reactive web components powering the dashboard UI.', url: 'https://lit.dev' },
  { name: '@agentclientprotocol/sdk', desc: 'Agent Client Protocol — structured agent ↔ gateway communication.', url: 'https://github.com/agentclientprotocol' },
  { name: 'typescript', desc: 'Strongly-typed JavaScript across the entire runtime.', url: 'https://www.typescriptlang.org' },
  { name: 'zod', desc: 'Runtime schema validation for configs, tools, and payloads.', url: 'https://zod.dev' },
  { name: 'express', desc: 'HTTP server powering the gateway REST surface.', url: 'https://expressjs.com' },
  { name: 'ws', desc: 'WebSocket transport between the dashboard and gateway.', url: 'https://github.com/websockets/ws' },
  { name: 'yaml', desc: 'Project configuration, rules, and context persistence.', url: 'https://eemeli.org/yaml/' },
  { name: 'playwright-core', desc: 'Headless browser control for web-scraping and automation skills.', url: 'https://playwright.dev' },
  { name: 'sharp', desc: 'Fast image processing for media-understanding pipelines.', url: 'https://sharp.pixelplumbing.com' },
  { name: 'croner', desc: 'Lightweight cron scheduler for recurring agent runs.', url: 'https://github.com/hexagon/croner' },
  { name: 'commander', desc: 'CLI argument parsing for the coderclaw command.', url: 'https://github.com/tj/commander.js' },
  { name: 'undici', desc: 'High-performance HTTP client for provider integrations.', url: 'https://undici.nodejs.org' },
  { name: 'vitest', desc: 'Fast unit and integration testing framework.', url: 'https://vitest.dev' },
  { name: 'pdfjs-dist', desc: 'PDF parsing support for document-understanding skills.', url: 'https://mozilla.github.io/pdf.js/' },
  { name: '@sinclair/typebox', desc: 'JSON schema generation for typed tool definitions.', url: 'https://github.com/sinclairzx81/typebox' },
  { name: '@slack/bolt', desc: 'Slack channel integration.', url: 'https://slack.dev/bolt-js/' },
  { name: 'grammy', desc: 'Telegram bot framework behind the Telegram channel.', url: 'https://grammy.dev' },
  { name: 'markdown-it', desc: 'Markdown rendering in the dashboard chat view.', url: 'https://markdown-it.github.io' },
  { name: 'astro', desc: 'The framework powering the docs site.', url: 'https://astro.build' },
  { name: 'drizzle-orm', desc: 'Type-safe ORM used in Builderforce for PostgreSQL.', url: 'https://orm.drizzle.team' },
  { name: 'hono', desc: 'Edge-first web framework for the Builderforce API.', url: 'https://hono.dev' },
];

const differences = [
  { title: 'Deep Code Knowledge', body: 'AST parsing, semantic code maps, dependency graphs, cross-file reference tracking, and Git history awareness — persisted to .coderClaw/.' },
  { title: 'Multi-Agent Orchestration', body: '7 built-in specialist roles (Architect, Developer, Reviewer, Tester, Debugger, Refactorer, Documenter) with dynamic task lifecycle and formal execution state machines.' },
  { title: 'Full Dev Lifecycle', body: 'PRD → Architecture → Task breakdown → Code → Review → Test → Debug → Refactor — orchestrated in a single runtime, no IDE required.' },
  { title: 'Builderforce Integration', body: 'REST API at api.builderforce.ai for multi-tenant project management, agent registration, execution tracking, and audit trails — Cloudflare Workers + Neon PostgreSQL.' },
  { title: 'Self-Hosted & Open', body: 'Your code stays on your machine. MIT-licensed. No IDE tether, no vendor cloud, no subscription ceiling.' },
  { title: 'Channel-Agnostic', body: "Inherits all of OpenClaw's channel integrations — trigger coding workflows from WhatsApp, Telegram, Slack, or Discord just as easily as from the terminal." },
];

export default function AcknowledgementsPage() {
  return (
    <ProsePage width="wide">
      <h1>Acknowledgements</h1>
      <p className="lead">
        CoderClaw wouldn&apos;t exist without giants to stand on. Here&apos;s where we came from and who we thank.
      </p>

      <section>
        <h2>Built on OpenClaw 🦞</h2>
        <p>
          CoderClaw started as a fork of <a href="https://openclaw.ai" target="_blank" rel="noopener">OpenClaw</a> —
          the open-source personal AI assistant built by the OpenClaw team. OpenClaw gave us a battle-tested gateway
          runtime, multi-channel connectivity (WhatsApp, Telegram, Slack, Discord, Signal, iMessage…), a reactive
          Lit-based dashboard UI, the plugin / skills infrastructure, and an opinionated project structure we could
          build on immediately.
        </p>
        <p>
          <strong>Thank you</strong> to every contributor at{' '}
          <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener">github.com/openclaw/openclaw</a>{' '}
          for the head-start. CoderClaw would not exist without your work.
        </p>
      </section>

      <section>
        <h2>How CoderClaw Extends OpenClaw 🚀</h2>
        <p>
          CoderClaw kept everything that makes OpenClaw great and added a focused developer-first orchestration layer
          on top.
        </p>
        <ul>
          {differences.map((d) => (
            <li key={d.title}>
              <strong>{d.title}:</strong> {d.body}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Get Started 📦</h2>
        <p>Node ≥ 22 required.</p>
        <pre><code># Install
npm install -g coderclaw@latest

# Or with pnpm
pnpm add -g coderclaw@latest

# Onboard
coderclaw onboard --install-daemon</code></pre>
      </section>

      <section>
        <h2>Open-Source Packages 📚</h2>
        <p>CoderClaw is powered by an excellent ecosystem of open-source projects. We&apos;re grateful to every maintainer.</p>
        <ul>
          {packages.map((p) => (
            <li key={p.name}>
              <a href={p.url} target="_blank" rel="noopener"><code>{p.name}</code></a> — {p.desc}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Built By 👤</h2>
        <p>
          <a href="https://myvideoresu.me/resumes/seanhogg" target="_blank" rel="noopener">Sean Hogg</a> — Developer,
          architect, and maintainer of CoderClaw and Builderforce.ai.{' '}
          <a href="https://github.com/SeanHogg" target="_blank" rel="noopener">GitHub</a> ·{' '}
          <a href="/coderclaw/contact">Contact</a>
        </p>
      </section>

      <section>
        <h2>License ⚖️</h2>
        <p>
          CoderClaw is released under the{' '}
          <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener">MIT License</a>. Use it, fork it,
          ship it.
        </p>
      </section>
    </ProsePage>
  );
}
