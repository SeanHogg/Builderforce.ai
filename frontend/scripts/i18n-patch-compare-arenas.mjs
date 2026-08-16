#!/usr/bin/env node
/**
 * `/compare` becomes multi-arena: `compare.categories` -> `compare.arenas.<key>`.
 *
 * The comparison page only ever compared ONE market — AI coding agents — while
 * the product is also bought against trackers, canvases, automation builders,
 * AI gateways and talent marketplaces. `COMPARE_ARENAS` (lib/content.ts) owns
 * the arena keys and column order; this writes the copy that goes with them.
 *
 * Shape change, applied to all five catalogs so the parity test stays green:
 *
 *   compare.categories            ->  compare.arenas.agentic.categories
 *   (new)                         ->  compare.arenas.<key>.{label,blurb,categories}
 *   (new)                         ->  compare.competitorLabels.<newKey>
 *   (new)                         ->  compare.arenaTabsLabel
 *
 * The agentic arena's categories are MOVED, never re-authored — they are
 * already translated and already correct. Everything new is authored in English
 * once and translated through `T`, which throws on a gap so a locale can never
 * silently inherit English. Cells are `✅ / ⚠️ / ❌` plus an optional short
 * qualifier; only the qualifier is translated.
 *
 * Idempotent: re-running reads the already-migrated catalog and rewrites the
 * same result. Run once via `node scripts/i18n-patch-compare-arenas.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/i18n/messages');
const LOCALES = ['en', 'zh', 'es', 'fr', 'de'];

/** Vendor columns added by the new arenas. Brand names stay literal in every locale. */
const NEW_COMPETITOR_LABELS = {
  jira: 'Jira',
  linear: 'Linear',
  asana: 'Asana',
  monday: 'Monday.com',
  azureBoards: 'Azure Boards',
  figma: 'Figma',
  canva: 'Canva',
  miro: 'Miro',
  notion: 'Notion',
  zapier: 'Zapier',
  n8n: 'n8n',
  make: 'Make',
  copilotStudio: 'Copilot Studio',
  langgraph: 'LangGraph / CrewAI',
  openrouter: 'OpenRouter',
  litellm: 'LiteLLM',
  portkey: 'Portkey',
  bedrock: 'Amazon Bedrock',
  helicone: 'Helicone',
  upwork: 'Upwork',
  fiverr: 'Fiverr',
  toptal: 'Toptal',
  agencies: 'Dev agencies',
};

/* ──────────────────────────────────────────────────────────────────────────
   English source of truth. `values` keys are `builderforce` plus that arena's
   COMPARE_ARENAS column keys, in the same order.
   ────────────────────────────────────────────────────────────────────────── */

const ARENA_LABELS = {
  agentic: {
    label: 'AI coding agents',
    blurb:
      'Editors, terminal agents and hosted engineering agents. Compare what happens to the work before the code is written and after it is merged.',
  },
  delivery: {
    label: 'Delivery & work management',
    blurb:
      'Trackers and work-management suites organize the work. Compare who plans it, who executes it, and what evidence is left behind.',
  },
  canvas: {
    label: 'Creative canvas & docs',
    blurb:
      'Design, whiteboard and document tools shape the artifact. Compare what happens to that artifact once it has to become work.',
  },
  automation: {
    label: 'Workflow & agent automation',
    blurb:
      'Automation builders and agent frameworks wire steps together. Compare what happens when a step needs judgement, review, or a person.',
  },
  gateway: {
    label: 'AI gateway & model routing',
    blurb:
      'Gateways put one API in front of many models. Compare routing, attribution, and what happens after the tokens are spent.',
  },
  talent: {
    label: 'Talent & agent marketplace',
    blurb:
      'Marketplaces match work to people. Compare how work is sourced, run and paid for when part of the team is an agent.',
  },
};

const NEW_ARENA_CATEGORIES = {
  delivery: [
    {
      id: 'delivery-planning',
      title: 'Planning & portfolio',
      blurb: 'Backlogs, objectives, and the rollup an executive actually reads.',
      rows: [
        {
          feature: 'Backlog, sprints and boards',
          values: { builderforce: '✅', jira: '✅', linear: '✅', asana: '✅', monday: '✅', azureBoards: '✅' },
        },
        {
          feature: 'OKRs linked to delivery items',
          note: 'objectives and key results as first-class records',
          values: { builderforce: '✅', jira: '⚠️ Marketplace app', linear: '⚠️ Initiatives', asana: '✅ Goals', monday: '⚠️ Add-on', azureBoards: '❌' },
        },
        {
          feature: 'Portfolio rollup across projects',
          values: { builderforce: '✅', jira: '⚠️ Higher tier', linear: '⚠️ Limited', asana: '⚠️ Portfolios', monday: '⚠️ Higher tier', azureBoards: '⚠️ Limited' },
        },
        {
          feature: 'Health verdict computed from run evidence',
          note: 'one scoring rule, not a hand-set status',
          values: { builderforce: '✅', jira: '⚠️ Manual status', linear: '⚠️ Manual status', asana: '⚠️ Manual status', monday: '⚠️ Manual status', azureBoards: '⚠️ Manual status' },
        },
      ],
    },
    {
      id: 'delivery-execution',
      title: 'Who does the work',
      blurb: 'Whether the tracker only records the work, or also runs it.',
      rows: [
        {
          feature: 'AI agents assignable like team members',
          note: 'people and agents on one board',
          values: { builderforce: '✅', jira: '❌', linear: '❌', asana: '❌', monday: '❌', azureBoards: '❌' },
        },
        {
          feature: 'Ticket executed end to end by an agent run',
          values: { builderforce: '✅', jira: '❌', linear: '❌', asana: '❌', monday: '❌', azureBoards: '❌' },
        },
        {
          feature: 'Autonomous lane starts a run on drop',
          values: { builderforce: '✅', jira: '⚠️ Automation rules', linear: '⚠️ Automation rules', asana: '⚠️ Automation rules', monday: '⚠️ Automation rules', azureBoards: '⚠️ Automation rules' },
        },
        {
          feature: 'Role-gated lifecycle with recorded sign-off',
          note: 'per-ticket role plus an approval record',
          values: { builderforce: '✅', jira: '⚠️ Workflow rules', linear: '⚠️ Basic', asana: '⚠️ Approvals', monday: '⚠️ Approvals', azureBoards: '⚠️ Workflow rules' },
        },
      ],
    },
    {
      id: 'delivery-evidence',
      title: 'Ceremonies & evidence',
      blurb: 'What the team runs inside the product, and what stays auditable afterwards.',
      rows: [
        {
          feature: 'Standups, retros and estimation in-product',
          values: { builderforce: '✅', jira: '⚠️ Marketplace apps', linear: '❌', asana: '❌', monday: '⚠️ Marketplace apps', azureBoards: '⚠️ Extensions' },
        },
        {
          feature: 'People and agents in one audit log',
          values: { builderforce: '✅', jira: '⚠️ Per-item history', linear: '⚠️ Per-item history', asana: '⚠️ Per-item history', monday: '⚠️ Per-item history', azureBoards: '⚠️ Per-item history' },
        },
        {
          feature: 'Execution transcript attached to the item',
          values: { builderforce: '✅', jira: '❌', linear: '❌', asana: '❌', monday: '❌', azureBoards: '❌' },
        },
        {
          feature: 'Two-way sync with existing trackers',
          note: 'board-sync connectors',
          values: { builderforce: '✅', jira: '⚠️ Via apps', linear: '⚠️ Via apps', asana: '⚠️ Via apps', monday: '⚠️ Via apps', azureBoards: '⚠️ Via apps' },
        },
      ],
    },
  ],
  canvas: [
    {
      id: 'canvas-surface',
      title: 'The making surface',
      blurb: 'What you can put on the canvas, and who is allowed to put it there.',
      rows: [
        {
          feature: 'Infinite canvas with typed objects',
          note: 'spec-driven objects, not free-form shapes',
          values: { builderforce: '✅', figma: '⚠️ Free-form frames', canva: '⚠️ Page templates', miro: '⚠️ Free-form shapes', notion: '❌ Document-first' },
        },
        {
          feature: 'Documents, slides, sheets and boards on one surface',
          values: { builderforce: '✅', figma: '⚠️ Design + slides', canva: '✅', miro: '⚠️ Board-first', notion: '⚠️ Docs + databases' },
        },
        {
          feature: 'Agents create and edit objects alongside you',
          values: { builderforce: '✅', figma: '⚠️ Assisted edits', canva: '⚠️ Assisted generation', miro: '⚠️ Assisted diagrams', notion: '⚠️ Assisted writing' },
        },
        {
          feature: 'Export to PDF and a print layout',
          values: { builderforce: '✅', figma: '✅', canva: '✅', miro: '✅', notion: '✅' },
        },
      ],
    },
    {
      id: 'canvas-connected',
      title: 'Connected to delivery',
      blurb: 'Whether an idea on the canvas can become tracked, governed work without leaving it.',
      rows: [
        {
          feature: 'A canvas object becomes a delivery ticket',
          values: { builderforce: '✅', figma: '⚠️ Via integration', canva: '❌', miro: '⚠️ Via integration', notion: '⚠️ Via integration' },
        },
        {
          feature: 'Totals derived from their own rows',
          note: 'never stored twice',
          values: { builderforce: '✅', figma: '❌', canva: '❌', miro: '❌', notion: '⚠️ Formulas' },
        },
        {
          feature: 'Publish a creation as a sellable listing',
          values: { builderforce: '✅', figma: '⚠️ Community assets', canva: '⚠️ Template marketplace', miro: '⚠️ Template gallery', notion: '⚠️ Template gallery' },
        },
        {
          feature: 'Runs a working app from the same project',
          note: 'embedded apps served from the creation',
          values: { builderforce: '✅', figma: '⚠️ Prototypes', canva: '❌', miro: '❌', notion: '⚠️ Published pages' },
        },
      ],
    },
    {
      id: 'canvas-control',
      title: 'Control & reach',
      blurb: 'Where the work is stored, and who is allowed to open it.',
      rows: [
        {
          feature: 'Self-hosted / private deployment',
          values: { builderforce: '✅', figma: '❌', canva: '❌', miro: '❌', notion: '❌' },
        },
        {
          feature: 'Role-based access with approval gates',
          values: { builderforce: '✅', figma: '⚠️ Team permissions', canva: '⚠️ Team permissions', miro: '⚠️ Team permissions', notion: '⚠️ Team permissions' },
        },
        {
          feature: 'A guest can work before signing up',
          values: { builderforce: '✅', figma: '⚠️ View-only links', canva: '⚠️ Link editing', miro: '⚠️ Guest boards', notion: '⚠️ View-only links' },
        },
      ],
    },
  ],
  automation: [
    {
      id: 'automation-authoring',
      title: 'Building the workflow',
      blurb: 'How a flow is authored, and how much of it can be reasoning rather than wiring.',
      rows: [
        {
          feature: 'Visual workflow builder',
          values: { builderforce: '✅', zapier: '✅', n8n: '✅', make: '✅', copilotStudio: '✅', langgraph: '❌ Code-first' },
        },
        {
          feature: 'LLM reasoning as a first-class node',
          values: { builderforce: '✅', zapier: '⚠️ AI steps', n8n: '✅', make: '⚠️ AI modules', copilotStudio: '✅', langgraph: '✅' },
        },
        {
          feature: 'Specialist agent roles with a dependency graph',
          note: 'roles, not only steps',
          values: { builderforce: '✅', zapier: '❌', n8n: '⚠️ Sub-workflows', make: '❌', copilotStudio: '⚠️ Topics', langgraph: '✅' },
        },
        {
          feature: 'MCP — consume and expose as a server',
          values: { builderforce: '✅', zapier: '⚠️ Consume only', n8n: '⚠️ Consume only', make: '❌', copilotStudio: '⚠️ Consume only', langgraph: '⚠️ Consume only' },
        },
      ],
    },
    {
      id: 'automation-runtime',
      title: 'Running it safely',
      blurb: 'What stands between an automated step and a consequence you cannot undo.',
      rows: [
        {
          feature: 'Approval gate before a consequential action',
          values: { builderforce: '✅', zapier: '⚠️ Manual step', n8n: '⚠️ Wait node', make: '⚠️ Manual step', copilotStudio: '⚠️ Basic', langgraph: '⚠️ Custom code' },
        },
        {
          feature: 'Policy packs enforced at execution',
          values: { builderforce: '✅', zapier: '❌', n8n: '❌', make: '❌', copilotStudio: '⚠️ Tenant policy', langgraph: '❌' },
        },
        {
          feature: 'Run transcript, cost and retries observable',
          values: { builderforce: '✅', zapier: '⚠️ Task history', n8n: '✅ Executions', make: '⚠️ Run history', copilotStudio: '⚠️ Analytics', langgraph: '⚠️ Tracing add-on' },
        },
        {
          feature: 'Circuit breaker halts a failing loop',
          note: 'repeated failures cap the lane',
          values: { builderforce: '✅', zapier: '⚠️ Auto-pause', n8n: '⚠️ Error workflow', make: '⚠️ Auto-disable', copilotStudio: '❌', langgraph: '⚠️ Custom code' },
        },
      ],
    },
    {
      id: 'automation-scope',
      title: 'Beyond the automation',
      blurb: 'What the same product does once the flow has run.',
      rows: [
        {
          feature: 'The same product plans and tracks the work',
          values: { builderforce: '✅', zapier: '❌', n8n: '❌', make: '❌', copilotStudio: '❌', langgraph: '❌' },
        },
        {
          feature: 'Writes and reviews code in a repository',
          values: { builderforce: '✅', zapier: '❌', n8n: '⚠️ Code nodes', make: '❌', copilotStudio: '❌', langgraph: '⚠️ Build it yourself' },
        },
        {
          feature: 'Self-hosted / open runtime',
          values: { builderforce: '✅', zapier: '❌', n8n: '✅', make: '❌', copilotStudio: '❌', langgraph: '✅' },
        },
      ],
    },
  ],
  gateway: [
    {
      id: 'gateway-access',
      title: 'One API, many models',
      blurb: 'Which models you can reach, and whose credentials pay for them.',
      rows: [
        {
          feature: 'One API across model providers',
          values: { builderforce: '✅', openrouter: '✅', litellm: '✅', portkey: '✅', bedrock: '⚠️ Own catalog', helicone: '✅' },
        },
        {
          feature: 'Bring your own provider keys',
          values: { builderforce: '✅', openrouter: '⚠️ Some providers', litellm: '✅', portkey: '✅', bedrock: '❌ Cloud account', helicone: '✅' },
        },
        {
          feature: 'Local / offline models',
          values: { builderforce: '✅', openrouter: '❌', litellm: '✅', portkey: '⚠️ Self-hosted', bedrock: '❌', helicone: '⚠️ Proxy any endpoint' },
        },
        {
          feature: 'Subscription sign-in as a credential',
          note: 'OAuth, not only an API key',
          values: { builderforce: '✅', openrouter: '❌', litellm: '❌', portkey: '❌', bedrock: '❌', helicone: '❌' },
        },
      ],
    },
    {
      id: 'gateway-routing',
      title: 'Routing & spend',
      blurb: 'How a request finds a model, and how the cost is attributed.',
      rows: [
        {
          feature: 'Fallback when a provider fails',
          values: { builderforce: '✅', openrouter: '✅', litellm: '✅', portkey: '✅', bedrock: '⚠️ Limited', helicone: '⚠️ Limited' },
        },
        {
          feature: 'Routing reordered by measured outcomes',
          note: 'run scores feed the next pick',
          values: { builderforce: '✅', openrouter: '⚠️ Price / latency', litellm: '⚠️ Latency-based', portkey: '⚠️ Conditional rules', bedrock: '❌', helicone: '❌' },
        },
        {
          feature: 'Prompt caching applied at the gateway',
          values: { builderforce: '✅', openrouter: '⚠️ Provider-dependent', litellm: '✅', portkey: '✅', bedrock: '⚠️ Provider-dependent', helicone: '✅' },
        },
        {
          feature: 'Per-tenant metering and billing',
          values: { builderforce: '✅', openrouter: '⚠️ Per-key credits', litellm: '✅ Virtual keys', portkey: '✅', bedrock: '⚠️ Cloud billing', helicone: '⚠️ Analytics only' },
        },
      ],
    },
    {
      id: 'gateway-beyond',
      title: 'What the tokens were for',
      blurb: 'Whether spend can be traced back to the work that caused it.',
      rows: [
        {
          feature: 'Usage attributed to a project and a ticket',
          values: { builderforce: '✅', openrouter: '⚠️ Metadata tags', litellm: '⚠️ Metadata tags', portkey: '⚠️ Metadata tags', bedrock: '❌', helicone: '⚠️ Custom properties' },
        },
        {
          feature: 'The agents that spend the tokens ship with it',
          values: { builderforce: '✅', openrouter: '❌', litellm: '❌', portkey: '❌', bedrock: '⚠️ Build it yourself', helicone: '❌' },
        },
        {
          feature: 'Self-hosted / open source',
          values: { builderforce: '✅', openrouter: '❌', litellm: '✅', portkey: '✅', bedrock: '❌', helicone: '✅' },
        },
      ],
    },
  ],
  talent: [
    {
      id: 'talent-sourcing',
      title: 'Finding capacity',
      blurb: 'How a team is assembled when part of it is not human.',
      rows: [
        {
          feature: 'Hire a person for a scoped engagement',
          values: { builderforce: '✅', upwork: '✅', fiverr: '✅', toptal: '✅', agencies: '✅' },
        },
        {
          feature: 'Hire an AI agent the same way',
          note: 'agents are workforce records',
          values: { builderforce: '✅', upwork: '❌', fiverr: '❌', toptal: '❌', agencies: '❌' },
        },
        {
          feature: 'Skills and agents in one catalog',
          values: { builderforce: '✅', upwork: '⚠️ Freelancer profiles', fiverr: '⚠️ Gig listings', toptal: '⚠️ Vetted profiles', agencies: '❌' },
        },
        {
          feature: 'Third-party publishers ship connectors and skills',
          values: { builderforce: '✅', upwork: '❌', fiverr: '❌', toptal: '❌', agencies: '❌' },
        },
      ],
    },
    {
      id: 'talent-delivery',
      title: 'Doing the work',
      blurb: 'Where the engagement actually runs once it is signed.',
      rows: [
        {
          feature: 'A delivery board comes with the engagement',
          values: { builderforce: '✅', upwork: '⚠️ Basic tracker', fiverr: '❌', toptal: '❌', agencies: "⚠️ The agency's own" },
        },
        {
          feature: 'Work is executed and reviewed in the same product',
          values: { builderforce: '✅', upwork: '❌', fiverr: '❌', toptal: '❌', agencies: '❌' },
        },
        {
          feature: 'Approval gates before work is accepted',
          values: { builderforce: '✅', upwork: '⚠️ Milestones', fiverr: '⚠️ Order review', toptal: '⚠️ Contract terms', agencies: '⚠️ Contract terms' },
        },
      ],
    },
    {
      id: 'talent-commercial',
      title: 'Commercial terms',
      blurb: 'What is sold, and what the platform takes.',
      rows: [
        {
          feature: 'Take rate on marketplace sales',
          note: 'no platform fee below the published threshold',
          values: { builderforce: '✅ 0% under the threshold', upwork: 'See vendor pricing', fiverr: 'See vendor pricing', toptal: 'See vendor pricing', agencies: 'Negotiated' },
        },
        {
          feature: 'Sell a creation, not only hours',
          values: { builderforce: '✅', upwork: '⚠️ Project catalog', fiverr: '✅ Gigs', toptal: '❌', agencies: '⚠️ Negotiated' },
        },
        {
          feature: 'Run the same platform on your own infrastructure',
          values: { builderforce: '✅', upwork: '❌', fiverr: '❌', toptal: '❌', agencies: '❌' },
        },
      ],
    },
  ],
};

/** Tablist chrome. */
const ARENA_TABS_LABEL = 'Choose a comparison';

/* ──────────────────────────────────────────────────────────────────────────
   Translations. Keyed by the English source string so a repeated phrase is
   translated once and stays identical everywhere it appears.
   ────────────────────────────────────────────────────────────────────────── */

const T = {
  // ── Chrome ───────────────────────────────────────────────────────────────
  'Choose a comparison': { zh: '选择对比领域', es: 'Elige una comparación', fr: 'Choisissez une comparaison', de: 'Vergleich auswählen' },

  // ── Arena labels + blurbs ────────────────────────────────────────────────
  'AI coding agents': { zh: 'AI 编码智能体', es: 'Agentes de codificación con IA', fr: 'Agents de codage IA', de: 'KI-Coding-Agenten' },
  'Editors, terminal agents and hosted engineering agents. Compare what happens to the work before the code is written and after it is merged.': {
    zh: '编辑器、终端智能体与托管式工程智能体。对比一下：代码写出来之前和合并之后，这些工作分别会怎样推进。',
    es: 'Editores, agentes de terminal y agentes de ingeniería alojados. Compara qué ocurre con el trabajo antes de escribir el código y después de fusionarlo.',
    fr: 'Éditeurs, agents de terminal et agents d’ingénierie hébergés. Comparez ce qu’il advient du travail avant l’écriture du code et après sa fusion.',
    de: 'Editoren, Terminal-Agenten und gehostete Engineering-Agenten. Vergleichen Sie, was mit der Arbeit passiert, bevor der Code geschrieben und nachdem er gemergt wurde.',
  },
  'Delivery & work management': { zh: '交付与工作管理', es: 'Entrega y gestión del trabajo', fr: 'Livraison et gestion du travail', de: 'Delivery & Arbeitsmanagement' },
  'Trackers and work-management suites organize the work. Compare who plans it, who executes it, and what evidence is left behind.': {
    zh: '各类工单系统与工作管理套件负责组织工作。对比一下：谁来规划、谁来执行，以及最后留下了哪些可追溯的证据。',
    es: 'Los rastreadores y las suites de gestión del trabajo lo organizan. Compara quién lo planifica, quién lo ejecuta y qué evidencia queda registrada.',
    fr: 'Les outils de suivi et les suites de gestion du travail organisent le travail. Comparez qui le planifie, qui l’exécute et quelles preuves subsistent.',
    de: 'Tracker und Work-Management-Suiten organisieren die Arbeit. Vergleichen Sie, wer sie plant, wer sie ausführt und welche Nachweise zurückbleiben.',
  },
  'Creative canvas & docs': { zh: '创作画布与文档', es: 'Lienzo creativo y documentos', fr: 'Canevas créatif et documents', de: 'Kreativ-Canvas & Dokumente' },
  'Design, whiteboard and document tools shape the artifact. Compare what happens to that artifact once it has to become work.': {
    zh: '设计、白板与文档工具负责打磨成果物。对比一下：当这份成果物需要转化为实际工作时，会发生什么。',
    es: 'Las herramientas de diseño, pizarra y documentos dan forma al artefacto. Compara qué ocurre con ese artefacto cuando tiene que convertirse en trabajo.',
    fr: 'Les outils de design, de tableau blanc et de documents façonnent le livrable. Comparez ce qu’il advient de ce livrable lorsqu’il doit devenir du travail.',
    de: 'Design-, Whiteboard- und Dokumentwerkzeuge formen das Artefakt. Vergleichen Sie, was mit diesem Artefakt geschieht, sobald daraus Arbeit werden muss.',
  },
  'Workflow & agent automation': { zh: '工作流与智能体自动化', es: 'Automatización de flujos y agentes', fr: 'Automatisation des flux et des agents', de: 'Workflow- & Agenten-Automatisierung' },
  'Automation builders and agent frameworks wire steps together. Compare what happens when a step needs judgement, review, or a person.': {
    zh: '自动化搭建工具与智能体框架负责把各个步骤串联起来。对比一下：当某个步骤需要判断、需要评审或需要人介入时，会发生什么。',
    es: 'Los creadores de automatizaciones y los marcos de agentes conectan los pasos. Compara qué ocurre cuando un paso exige criterio, revisión o una persona.',
    fr: 'Les constructeurs d’automatisations et les frameworks d’agents relient les étapes. Comparez ce qui se passe lorsqu’une étape exige du jugement, une revue ou une personne.',
    de: 'Automatisierungs-Builder und Agenten-Frameworks verketten Schritte. Vergleichen Sie, was passiert, wenn ein Schritt Urteilsvermögen, eine Prüfung oder einen Menschen erfordert.',
  },
  'AI gateway & model routing': { zh: 'AI 网关与模型路由', es: 'Pasarela de IA y enrutado de modelos', fr: 'Passerelle IA et routage des modèles', de: 'KI-Gateway & Modell-Routing' },
  'Gateways put one API in front of many models. Compare routing, attribution, and what happens after the tokens are spent.': {
    zh: '网关用一个 API 统一接入多个模型。对比一下：请求如何路由、用量如何归属，以及 token 花掉之后会怎样。',
    es: 'Las pasarelas ponen una sola API delante de muchos modelos. Compara el enrutado, la atribución y qué ocurre una vez gastados los tokens.',
    fr: 'Les passerelles placent une seule API devant de nombreux modèles. Comparez le routage, l’attribution et ce qui se passe une fois les tokens dépensés.',
    de: 'Gateways stellen eine API vor viele Modelle. Vergleichen Sie Routing, Zuordnung und was geschieht, nachdem die Tokens verbraucht sind.',
  },
  'Talent & agent marketplace': { zh: '人才与智能体市场', es: 'Marketplace de talento y agentes', fr: 'Place de marché de talents et d’agents', de: 'Talent- & Agenten-Marktplatz' },
  'Marketplaces match work to people. Compare how work is sourced, run and paid for when part of the team is an agent.': {
    zh: '各类市场把工作与人对接起来。对比一下：当团队中有一部分成员是智能体时，工作如何寻源、如何执行、如何结算。',
    es: 'Los marketplaces conectan el trabajo con las personas. Compara cómo se contrata, se ejecuta y se paga el trabajo cuando parte del equipo es un agente.',
    fr: 'Les places de marché mettent le travail en relation avec des personnes. Comparez comment le travail est trouvé, exécuté et payé lorsqu’une partie de l’équipe est un agent.',
    de: 'Marktplätze bringen Arbeit und Menschen zusammen. Vergleichen Sie, wie Arbeit gefunden, ausgeführt und bezahlt wird, wenn ein Teil des Teams ein Agent ist.',
  },

  // ── Category titles + blurbs ─────────────────────────────────────────────
  'Planning & portfolio': { zh: '规划与项目组合', es: 'Planificación y portafolio', fr: 'Planification et portefeuille', de: 'Planung & Portfolio' },
  'Backlogs, objectives, and the rollup an executive actually reads.': {
    zh: '待办列表、目标，以及高管真正会看的汇总视图。',
    es: 'Backlogs, objetivos y el resumen que un directivo lee de verdad.',
    fr: 'Backlogs, objectifs et la synthèse qu’un dirigeant lit vraiment.',
    de: 'Backlogs, Ziele und die Zusammenfassung, die eine Führungskraft tatsächlich liest.',
  },
  'Who does the work': { zh: '由谁来完成工作', es: 'Quién hace el trabajo', fr: 'Qui fait le travail', de: 'Wer die Arbeit erledigt' },
  'Whether the tracker only records the work, or also runs it.': {
    zh: '工单系统只是记录工作，还是也能实际执行工作。',
    es: 'Si la herramienta solo registra el trabajo o además lo ejecuta.',
    fr: 'Si l’outil se contente d’enregistrer le travail ou s’il l’exécute aussi.',
    de: 'Ob der Tracker die Arbeit nur erfasst oder sie auch ausführt.',
  },
  'Ceremonies & evidence': { zh: '敏捷仪式与证据留存', es: 'Ceremonias y evidencia', fr: 'Cérémonies et traçabilité', de: 'Zeremonien & Nachweise' },
  'What the team runs inside the product, and what stays auditable afterwards.': {
    zh: '团队能在产品内部完成哪些活动，以及事后还能审计到什么。',
    es: 'Qué ejecuta el equipo dentro del producto y qué queda auditable después.',
    fr: 'Ce que l’équipe exécute dans le produit et ce qui reste auditable ensuite.',
    de: 'Was das Team im Produkt selbst durchführt und was danach prüfbar bleibt.',
  },
  'The making surface': { zh: '创作所在的界面', es: 'La superficie de creación', fr: 'La surface de création', de: 'Die Arbeitsfläche' },
  'What you can put on the canvas, and who is allowed to put it there.': {
    zh: '你能在画布上放置哪些内容，以及谁有权限放置它们。',
    es: 'Qué puedes colocar en el lienzo y quién tiene permiso para hacerlo.',
    fr: 'Ce que vous pouvez placer sur le canevas et qui est autorisé à le faire.',
    de: 'Was Sie auf die Arbeitsfläche legen können und wer das darf.',
  },
  'Connected to delivery': { zh: '与交付相连', es: 'Conectado con la entrega', fr: 'Relié à la livraison', de: 'Mit der Lieferung verbunden' },
  'Whether an idea on the canvas can become tracked, governed work without leaving it.': {
    zh: '画布上的一个想法，能否在不离开画布的情况下变成可追踪、可治理的工作。',
    es: 'Si una idea del lienzo puede convertirse en trabajo rastreado y gobernado sin salir de él.',
    fr: 'Si une idée posée sur le canevas peut devenir un travail suivi et gouverné sans le quitter.',
    de: 'Ob eine Idee auf der Arbeitsfläche zu nachverfolgter, gesteuerter Arbeit wird, ohne sie zu verlassen.',
  },
  'Control & reach': { zh: '控制权与可达范围', es: 'Control y alcance', fr: 'Contrôle et portée', de: 'Kontrolle & Reichweite' },
  'Where the work is stored, and who is allowed to open it.': {
    zh: '工作内容存放在哪里，以及谁有权限打开它。',
    es: 'Dónde se almacena el trabajo y quién puede abrirlo.',
    fr: 'Où le travail est stocké et qui a le droit de l’ouvrir.',
    de: 'Wo die Arbeit gespeichert ist und wer sie öffnen darf.',
  },
  'Building the workflow': { zh: '构建工作流', es: 'Construir el flujo', fr: 'Construire le flux', de: 'Den Workflow bauen' },
  'How a flow is authored, and how much of it can be reasoning rather than wiring.': {
    zh: '一条流程是如何编排的，其中有多少可以交给推理判断，而不是靠手工连线。',
    es: 'Cómo se crea un flujo y qué parte puede ser razonamiento en lugar de cableado manual.',
    fr: 'Comment un flux est conçu et quelle part relève du raisonnement plutôt que du câblage.',
    de: 'Wie ein Flow erstellt wird und wie viel davon Reasoning statt Verdrahtung sein kann.',
  },
  'Running it safely': { zh: '安全地运行', es: 'Ejecutarlo con seguridad', fr: 'L’exécuter en sécurité', de: 'Sicher ausführen' },
  'What stands between an automated step and a consequence you cannot undo.': {
    zh: '在一个自动化步骤与不可撤销的后果之间，还隔着什么。',
    es: 'Qué se interpone entre un paso automatizado y una consecuencia irreversible.',
    fr: 'Ce qui sépare une étape automatisée d’une conséquence irréversible.',
    de: 'Was zwischen einem automatisierten Schritt und einer nicht umkehrbaren Folge steht.',
  },
  'Beyond the automation': { zh: '自动化之外', es: 'Más allá de la automatización', fr: 'Au-delà de l’automatisation', de: 'Über die Automatisierung hinaus' },
  'What the same product does once the flow has run.': {
    zh: '流程跑完之后，同一个产品还能做什么。',
    es: 'Qué hace el mismo producto una vez que el flujo se ha ejecutado.',
    fr: 'Ce que fait le même produit une fois le flux exécuté.',
    de: 'Was dasselbe Produkt tut, nachdem der Flow gelaufen ist.',
  },
  'One API, many models': { zh: '一个 API，多个模型', es: 'Una API, muchos modelos', fr: 'Une API, de nombreux modèles', de: 'Eine API, viele Modelle' },
  'Which models you can reach, and whose credentials pay for them.': {
    zh: '你能接入哪些模型，以及由谁的凭据来付费。',
    es: 'A qué modelos puedes acceder y con qué credenciales se pagan.',
    fr: 'Quels modèles vous pouvez atteindre et avec quels identifiants ils sont payés.',
    de: 'Welche Modelle Sie erreichen und über wessen Zugangsdaten sie bezahlt werden.',
  },
  'Routing & spend': { zh: '路由与花费', es: 'Enrutado y gasto', fr: 'Routage et dépenses', de: 'Routing & Kosten' },
  'How a request finds a model, and how the cost is attributed.': {
    zh: '一个请求如何找到合适的模型，以及成本如何归属。',
    es: 'Cómo encuentra un modelo cada solicitud y cómo se atribuye el coste.',
    fr: 'Comment une requête trouve un modèle et comment le coût est attribué.',
    de: 'Wie eine Anfrage ein Modell findet und wie die Kosten zugeordnet werden.',
  },
  'What the tokens were for': { zh: 'token 究竟花在了什么上', es: 'Para qué se usaron los tokens', fr: 'À quoi ont servi les tokens', de: 'Wofür die Tokens verbraucht wurden' },
  'Whether spend can be traced back to the work that caused it.': {
    zh: '花费能否追溯到产生它的那项工作。',
    es: 'Si el gasto puede rastrearse hasta el trabajo que lo generó.',
    fr: 'Si la dépense peut être rattachée au travail qui l’a provoquée.',
    de: 'Ob sich Ausgaben auf die Arbeit zurückführen lassen, die sie verursacht hat.',
  },
  'Finding capacity': { zh: '寻找产能', es: 'Encontrar capacidad', fr: 'Trouver de la capacité', de: 'Kapazität finden' },
  'How a team is assembled when part of it is not human.': {
    zh: '当团队中有一部分成员不是人类时，团队该如何组建。',
    es: 'Cómo se forma un equipo cuando parte de él no es humano.',
    fr: 'Comment constituer une équipe dont une partie n’est pas humaine.',
    de: 'Wie ein Team zusammengestellt wird, wenn ein Teil davon nicht menschlich ist.',
  },
  'Doing the work': { zh: '实际开展工作', es: 'Hacer el trabajo', fr: 'Réaliser le travail', de: 'Die Arbeit erledigen' },
  'Where the engagement actually runs once it is signed.': {
    zh: '合作一旦签订，实际的工作在哪里进行。',
    es: 'Dónde se ejecuta realmente el encargo una vez firmado.',
    fr: 'Où la mission se déroule réellement une fois signée.',
    de: 'Wo das Engagement nach Vertragsabschluss tatsächlich läuft.',
  },
  'Commercial terms': { zh: '商务条款', es: 'Condiciones comerciales', fr: 'Conditions commerciales', de: 'Kommerzielle Bedingungen' },
  'What is sold, and what the platform takes.': {
    zh: '卖的究竟是什么，以及平台从中抽取多少。',
    es: 'Qué se vende y qué se queda la plataforma.',
    fr: 'Ce qui est vendu et ce que la plateforme prélève.',
    de: 'Was verkauft wird und was die Plattform davon einbehält.',
  },

  // ── Features + notes ─────────────────────────────────────────────────────
  'Backlog, sprints and boards': { zh: '待办列表、迭代与看板', es: 'Backlog, sprints y tableros', fr: 'Backlog, sprints et tableaux', de: 'Backlog, Sprints und Boards' },
  'OKRs linked to delivery items': { zh: 'OKR 与交付事项相互关联', es: 'OKR vinculados a los elementos de entrega', fr: 'OKR reliés aux éléments de livraison', de: 'OKRs mit Delivery-Elementen verknüpft' },
  'objectives and key results as first-class records': {
    zh: '目标与关键结果都是一等公民记录',
    es: 'objetivos y resultados clave como registros de primer nivel',
    fr: 'objectifs et résultats clés comme enregistrements à part entière',
    de: 'Objectives und Key Results als eigenständige Datensätze',
  },
  'Portfolio rollup across projects': { zh: '跨项目的组合汇总', es: 'Resumen de portafolio entre proyectos', fr: 'Consolidation de portefeuille entre projets', de: 'Portfolio-Rollup über Projekte hinweg' },
  'Health verdict computed from run evidence': { zh: '基于运行证据计算出的健康度判定', es: 'Veredicto de salud calculado con la evidencia de ejecución', fr: 'Verdict de santé calculé à partir des preuves d’exécution', de: 'Health-Bewertung aus Ausführungsnachweisen berechnet' },
  'one scoring rule, not a hand-set status': {
    zh: '统一的评分规则，而非手工设定的状态',
    es: 'una única regla de puntuación, no un estado fijado a mano',
    fr: 'une seule règle de notation, pas un statut saisi à la main',
    de: 'eine Bewertungsregel statt eines manuell gesetzten Status',
  },
  'AI agents assignable like team members': { zh: 'AI 智能体可像团队成员一样被指派', es: 'Agentes de IA asignables como miembros del equipo', fr: 'Agents IA assignables comme des membres de l’équipe', de: 'KI-Agenten wie Teammitglieder zuweisbar' },
  'people and agents on one board': { zh: '人与智能体同处一个看板', es: 'personas y agentes en un mismo tablero', fr: 'personnes et agents sur un même tableau', de: 'Menschen und Agenten auf einem Board' },
  'Ticket executed end to end by an agent run': { zh: '工单可由一次智能体运行端到端完成', es: 'Ticket ejecutado de principio a fin por una ejecución de agente', fr: 'Ticket exécuté de bout en bout par une exécution d’agent', de: 'Ticket durchgängig von einem Agenten-Lauf erledigt' },
  'Autonomous lane starts a run on drop': { zh: '自治泳道在卡片拖入时自动发起运行', es: 'El carril autónomo inicia una ejecución al soltar la tarjeta', fr: 'Une voie autonome lance une exécution au dépôt de la carte', de: 'Autonome Lane startet beim Ablegen einen Lauf' },
  'Role-gated lifecycle with recorded sign-off': { zh: '按角色把关的生命周期，并记录签核', es: 'Ciclo de vida con control por rol y aprobación registrada', fr: 'Cycle de vie contrôlé par rôle avec validation consignée', de: 'Rollenbasierter Lebenszyklus mit protokollierter Freigabe' },
  'per-ticket role plus an approval record': {
    zh: '每张工单都有角色，并留下审批记录',
    es: 'un rol por ticket más un registro de aprobación',
    fr: 'un rôle par ticket et un enregistrement de validation',
    de: 'Rolle je Ticket plus Freigabeeintrag',
  },
  'Standups, retros and estimation in-product': { zh: '站会、回顾与估点均在产品内进行', es: 'Dailies, retros y estimación dentro del producto', fr: 'Mêlées, rétrospectives et estimation dans le produit', de: 'Standups, Retros und Schätzung im Produkt' },
  'People and agents in one audit log': { zh: '人与智能体共用一份审计日志', es: 'Personas y agentes en un único registro de auditoría', fr: 'Personnes et agents dans un seul journal d’audit', de: 'Menschen und Agenten in einem Audit-Log' },
  'Execution transcript attached to the item': { zh: '执行过程记录直接附在事项上', es: 'Transcripción de la ejecución adjunta al elemento', fr: 'Transcription d’exécution jointe à l’élément', de: 'Ausführungsprotokoll am Element angehängt' },
  'Two-way sync with existing trackers': { zh: '与既有工单系统双向同步', es: 'Sincronización bidireccional con los rastreadores existentes', fr: 'Synchronisation bidirectionnelle avec les outils de suivi existants', de: 'Zwei-Wege-Sync mit vorhandenen Trackern' },
  'board-sync connectors': { zh: '看板同步连接器', es: 'conectores de sincronización de tableros', fr: 'connecteurs de synchronisation de tableaux', de: 'Board-Sync-Konnektoren' },
  'Infinite canvas with typed objects': { zh: '带类型对象的无限画布', es: 'Lienzo infinito con objetos tipados', fr: 'Canevas infini avec des objets typés', de: 'Unendliche Arbeitsfläche mit typisierten Objekten' },
  'spec-driven objects, not free-form shapes': {
    zh: '由规格定义的对象，而非自由绘制的图形',
    es: 'objetos definidos por especificación, no formas libres',
    fr: 'des objets définis par une spécification, pas des formes libres',
    de: 'spezifikationsgetriebene Objekte statt freier Formen',
  },
  'Documents, slides, sheets and boards on one surface': { zh: '文档、幻灯片、表格与看板同处一个界面', es: 'Documentos, diapositivas, hojas y tableros en una sola superficie', fr: 'Documents, diapositives, tableurs et tableaux sur une seule surface', de: 'Dokumente, Folien, Tabellen und Boards auf einer Fläche' },
  'Agents create and edit objects alongside you': { zh: '智能体与你一同创建和编辑对象', es: 'Los agentes crean y editan objetos junto a ti', fr: 'Les agents créent et modifient des objets à vos côtés', de: 'Agenten erstellen und bearbeiten Objekte an Ihrer Seite' },
  'Export to PDF and a print layout': { zh: '导出为 PDF 并支持打印排版', es: 'Exportar a PDF y a un diseño para imprimir', fr: 'Export en PDF et mise en page imprimable', de: 'Export als PDF und Druck-Layout' },
  'A canvas object becomes a delivery ticket': { zh: '画布上的对象可直接变成交付工单', es: 'Un objeto del lienzo se convierte en un ticket de entrega', fr: 'Un objet du canevas devient un ticket de livraison', de: 'Ein Objekt der Arbeitsfläche wird zum Delivery-Ticket' },
  'Totals derived from their own rows': { zh: '合计值由其自身的明细行推导得出', es: 'Totales derivados de sus propias filas', fr: 'Totaux dérivés de leurs propres lignes', de: 'Summen aus den eigenen Zeilen abgeleitet' },
  'never stored twice': { zh: '绝不重复存储', es: 'nunca se almacenan dos veces', fr: 'jamais stockés deux fois', de: 'nie doppelt gespeichert' },
  'Publish a creation as a sellable listing': { zh: '把创作发布为可售卖的商品', es: 'Publicar una creación como un artículo a la venta', fr: 'Publier une création comme une offre vendable', de: 'Eine Kreation als verkäufliches Angebot veröffentlichen' },
  'Runs a working app from the same project': { zh: '可从同一个项目直接运行一个可用的应用', es: 'Ejecuta una aplicación funcional desde el mismo proyecto', fr: 'Exécute une application fonctionnelle depuis le même projet', de: 'Führt aus demselben Projekt eine lauffähige App aus' },
  'embedded apps served from the creation': {
    zh: '直接由该创作提供服务的嵌入式应用',
    es: 'aplicaciones integradas servidas desde la propia creación',
    fr: 'applications intégrées servies depuis la création',
    de: 'eingebettete Apps, die aus der Kreation ausgeliefert werden',
  },
  'Self-hosted / private deployment': { zh: '自托管 / 私有化部署', es: 'Autoalojado / despliegue privado', fr: 'Auto-hébergé / déploiement privé', de: 'Self-Hosting / private Bereitstellung' },
  'Role-based access with approval gates': { zh: '基于角色的访问控制与审批关卡', es: 'Acceso basado en roles con puertas de aprobación', fr: 'Accès basé sur les rôles avec points de validation', de: 'Rollenbasierter Zugriff mit Freigabe-Gates' },
  'A guest can work before signing up': { zh: '访客无需注册即可先开始使用', es: 'Un invitado puede trabajar antes de registrarse', fr: 'Un invité peut travailler avant de créer un compte', de: 'Gäste können vor der Registrierung arbeiten' },
  'Visual workflow builder': { zh: '可视化工作流搭建器', es: 'Constructor visual de flujos', fr: 'Constructeur de flux visuel', de: 'Visueller Workflow-Builder' },
  'LLM reasoning as a first-class node': { zh: '把 LLM 推理作为一等公民节点', es: 'Razonamiento con LLM como nodo de primer nivel', fr: 'Raisonnement LLM comme nœud à part entière', de: 'LLM-Reasoning als eigenständiger Knoten' },
  'Specialist agent roles with a dependency graph': { zh: '专业化的智能体角色与依赖关系图', es: 'Roles de agente especializados con un grafo de dependencias', fr: 'Rôles d’agents spécialisés avec un graphe de dépendances', de: 'Spezialisierte Agentenrollen mit Abhängigkeitsgraph' },
  'roles, not only steps': { zh: '是角色，而不只是步骤', es: 'roles, no solo pasos', fr: 'des rôles, pas seulement des étapes', de: 'Rollen, nicht nur Schritte' },
  'MCP — consume and expose as a server': { zh: 'MCP —— 既能调用也能作为服务端暴露', es: 'MCP: consumir y exponer como servidor', fr: 'MCP — consommer et exposer en tant que serveur', de: 'MCP – nutzen und als Server bereitstellen' },
  'Approval gate before a consequential action': { zh: '在有实质后果的动作前设置审批关卡', es: 'Puerta de aprobación antes de una acción con consecuencias', fr: 'Point de validation avant une action lourde de conséquences', de: 'Freigabe-Gate vor einer folgenreichen Aktion' },
  'Policy packs enforced at execution': { zh: '在执行时强制生效的策略包', es: 'Paquetes de políticas aplicados en la ejecución', fr: 'Packs de politiques appliqués à l’exécution', de: 'Policy-Packs, die bei der Ausführung greifen' },
  'Run transcript, cost and retries observable': { zh: '运行记录、成本与重试全部可观测', es: 'Transcripción, coste y reintentos de cada ejecución observables', fr: 'Transcription, coût et relances de l’exécution observables', de: 'Ausführungsprotokoll, Kosten und Retries beobachtbar' },
  'Circuit breaker halts a failing loop': { zh: '熔断器可中止不断失败的循环', es: 'Un cortacircuitos detiene un bucle que falla', fr: 'Un coupe-circuit arrête une boucle en échec', de: 'Ein Circuit Breaker stoppt eine fehlschlagende Schleife' },
  'repeated failures cap the lane': {
    zh: '连续失败会为该泳道设置上限',
    es: 'los fallos repetidos limitan ese carril',
    fr: 'des échecs répétés plafonnent la voie',
    de: 'wiederholte Fehler begrenzen die Lane',
  },
  'The same product plans and tracks the work': { zh: '同一个产品同时负责规划与跟踪工作', es: 'El mismo producto planifica y hace seguimiento del trabajo', fr: 'Le même produit planifie et suit le travail', de: 'Dasselbe Produkt plant und verfolgt die Arbeit' },
  'Writes and reviews code in a repository': { zh: '可在代码仓库中编写并评审代码', es: 'Escribe y revisa código en un repositorio', fr: 'Écrit et relit du code dans un dépôt', de: 'Schreibt und reviewt Code in einem Repository' },
  'Self-hosted / open runtime': { zh: '自托管 / 开放运行时', es: 'Autoalojado / runtime abierto', fr: 'Auto-hébergé / runtime ouvert', de: 'Self-Hosting / offene Runtime' },
  'One API across model providers': { zh: '一个 API 打通多家模型厂商', es: 'Una sola API para todos los proveedores de modelos', fr: 'Une seule API pour tous les fournisseurs de modèles', de: 'Eine API über alle Modellanbieter hinweg' },
  'Bring your own provider keys': { zh: '可自带厂商密钥', es: 'Usa tus propias claves de proveedor', fr: 'Apportez vos propres clés de fournisseur', de: 'Eigene Anbieter-Schlüssel nutzbar' },
  'Local / offline models': { zh: '本地 / 离线模型', es: 'Modelos locales o sin conexión', fr: 'Modèles locaux / hors ligne', de: 'Lokale / Offline-Modelle' },
  'Subscription sign-in as a credential': { zh: '可用订阅账号登录作为凭据', es: 'Inicio de sesión de suscripción como credencial', fr: 'Connexion à un abonnement comme identifiant', de: 'Abo-Anmeldung als Zugangsdaten' },
  'OAuth, not only an API key': { zh: 'OAuth，而不只是 API 密钥', es: 'OAuth, no solo una clave de API', fr: 'OAuth, pas seulement une clé d’API', de: 'OAuth, nicht nur ein API-Schlüssel' },
  'Fallback when a provider fails': { zh: '厂商故障时可自动回退', es: 'Alternativa cuando un proveedor falla', fr: 'Repli lorsqu’un fournisseur échoue', de: 'Fallback, wenn ein Anbieter ausfällt' },
  'Routing reordered by measured outcomes': { zh: '根据实测结果重新排序路由', es: 'Enrutado reordenado según los resultados medidos', fr: 'Routage réordonné selon les résultats mesurés', de: 'Routing nach gemessenen Ergebnissen neu geordnet' },
  'run scores feed the next pick': {
    zh: '运行评分会影响下一次的选择',
    es: 'las puntuaciones de ejecución alimentan la siguiente elección',
    fr: 'les scores d’exécution orientent le choix suivant',
    de: 'Lauf-Scores fließen in die nächste Auswahl ein',
  },
  'Prompt caching applied at the gateway': { zh: '在网关层应用提示词缓存', es: 'Caché de prompts aplicada en la pasarela', fr: 'Mise en cache des prompts au niveau de la passerelle', de: 'Prompt-Caching am Gateway angewendet' },
  'Per-tenant metering and billing': { zh: '按租户计量与计费', es: 'Medición y facturación por inquilino', fr: 'Comptage et facturation par locataire', de: 'Messung und Abrechnung je Mandant' },
  'Usage attributed to a project and a ticket': { zh: '用量可归属到具体项目与工单', es: 'Uso atribuido a un proyecto y a un ticket', fr: 'Consommation attribuée à un projet et à un ticket', de: 'Verbrauch einem Projekt und Ticket zugeordnet' },
  'The agents that spend the tokens ship with it': { zh: '消耗这些 token 的智能体本身就随产品一起提供', es: 'Los agentes que gastan los tokens vienen incluidos', fr: 'Les agents qui consomment les tokens sont fournis avec', de: 'Die Agenten, die die Tokens verbrauchen, sind enthalten' },
  'Self-hosted / open source': { zh: '自托管 / 开源', es: 'Autoalojado / código abierto', fr: 'Auto-hébergé / open source', de: 'Self-Hosting / Open Source' },
  'Hire a person for a scoped engagement': { zh: '为界定范围的合作聘用人员', es: 'Contratar a una persona para un encargo acotado', fr: 'Recruter une personne pour une mission cadrée', de: 'Eine Person für ein abgegrenztes Engagement beauftragen' },
  'Hire an AI agent the same way': { zh: '用同样的方式聘用 AI 智能体', es: 'Contratar un agente de IA del mismo modo', fr: 'Recruter un agent IA de la même manière', de: 'Einen KI-Agenten auf dieselbe Weise beauftragen' },
  'agents are workforce records': {
    zh: '智能体也是劳动力名册中的记录',
    es: 'los agentes son registros de la plantilla',
    fr: 'les agents sont des fiches de la main-d’œuvre',
    de: 'Agenten sind Datensätze der Belegschaft',
  },
  'Skills and agents in one catalog': { zh: '技能与智能体同处一个目录', es: 'Habilidades y agentes en un solo catálogo', fr: 'Compétences et agents dans un même catalogue', de: 'Skills und Agenten in einem Katalog' },
  'Third-party publishers ship connectors and skills': { zh: '第三方发布者可提供连接器与技能', es: 'Editores externos publican conectores y habilidades', fr: 'Des éditeurs tiers publient connecteurs et compétences', de: 'Drittanbieter liefern Konnektoren und Skills' },
  'A delivery board comes with the engagement': { zh: '合作本身就自带一个交付看板', es: 'El encargo incluye un tablero de entrega', fr: 'La mission s’accompagne d’un tableau de livraison', de: 'Zum Engagement gehört ein Delivery-Board' },
  'Work is executed and reviewed in the same product': { zh: '工作在同一个产品内执行并评审', es: 'El trabajo se ejecuta y se revisa en el mismo producto', fr: 'Le travail est exécuté et relu dans le même produit', de: 'Arbeit wird im selben Produkt ausgeführt und geprüft' },
  'Approval gates before work is accepted': { zh: '在验收工作前设置审批关卡', es: 'Puertas de aprobación antes de aceptar el trabajo', fr: 'Points de validation avant l’acceptation du travail', de: 'Freigabe-Gates vor der Abnahme der Arbeit' },
  'Take rate on marketplace sales': { zh: '市场销售的平台抽成', es: 'Comisión sobre las ventas del marketplace', fr: 'Commission sur les ventes de la place de marché', de: 'Provision auf Marktplatz-Verkäufe' },
  'no platform fee below the published threshold': {
    zh: '低于公示门槛的部分不收取平台费用',
    es: 'sin comisión de plataforma por debajo del umbral publicado',
    fr: 'aucun frais de plateforme sous le seuil publié',
    de: 'keine Plattformgebühr unterhalb der veröffentlichten Schwelle',
  },
  'Sell a creation, not only hours': { zh: '售卖的是创作成果，而不只是工时', es: 'Vender una creación, no solo horas', fr: 'Vendre une création, pas seulement des heures', de: 'Eine Kreation verkaufen, nicht nur Stunden' },
  'Run the same platform on your own infrastructure': { zh: '可在你自己的基础设施上运行同一套平台', es: 'Ejecutar la misma plataforma en tu propia infraestructura', fr: 'Exécuter la même plateforme sur votre propre infrastructure', de: 'Dieselbe Plattform auf eigener Infrastruktur betreiben' },

  // ── Cell qualifiers ──────────────────────────────────────────────────────
  'Marketplace app': { zh: '需应用市场插件', es: 'App del marketplace', fr: 'Application du marketplace', de: 'Marketplace-App' },
  'Marketplace apps': { zh: '需应用市场插件', es: 'Apps del marketplace', fr: 'Applications du marketplace', de: 'Marketplace-Apps' },
  Initiatives: { zh: '仅“计划”功能', es: 'Iniciativas', fr: 'Initiatives', de: 'Initiativen' },
  Goals: { zh: '目标功能', es: 'Objetivos', fr: 'Objectifs', de: 'Ziele' },
  'Add-on': { zh: '需附加组件', es: 'Complemento', fr: 'Module complémentaire', de: 'Zusatzmodul' },
  'Higher tier': { zh: '需更高套餐', es: 'Plan superior', fr: 'Forfait supérieur', de: 'Höherer Tarif' },
  Limited: { zh: '有限支持', es: 'Limitado', fr: 'Limité', de: 'Eingeschränkt' },
  Portfolios: { zh: '组合功能', es: 'Portafolios', fr: 'Portefeuilles', de: 'Portfolios' },
  'Manual status': { zh: '手工设置状态', es: 'Estado manual', fr: 'Statut manuel', de: 'Manueller Status' },
  'Automation rules': { zh: '自动化规则', es: 'Reglas de automatización', fr: 'Règles d’automatisation', de: 'Automatisierungsregeln' },
  'Workflow rules': { zh: '工作流规则', es: 'Reglas de flujo', fr: 'Règles de workflow', de: 'Workflow-Regeln' },
  Basic: { zh: '基础支持', es: 'Básico', fr: 'Basique', de: 'Grundlegend' },
  Approvals: { zh: '审批功能', es: 'Aprobaciones', fr: 'Validations', de: 'Freigaben' },
  Extensions: { zh: '需扩展插件', es: 'Extensiones', fr: 'Extensions', de: 'Erweiterungen' },
  'Per-item history': { zh: '仅单条记录的历史', es: 'Historial por elemento', fr: 'Historique par élément', de: 'Historie je Element' },
  'Via apps': { zh: '需借助插件', es: 'Mediante apps', fr: 'Via des applications', de: 'Über Apps' },
  'Free-form frames': { zh: '自由画框', es: 'Marcos de forma libre', fr: 'Cadres libres', de: 'Freie Frames' },
  'Page templates': { zh: '页面模板', es: 'Plantillas de página', fr: 'Modèles de page', de: 'Seitenvorlagen' },
  'Free-form shapes': { zh: '自由图形', es: 'Formas libres', fr: 'Formes libres', de: 'Freie Formen' },
  'Document-first': { zh: '以文档为主', es: 'Orientado a documentos', fr: 'Orienté document', de: 'Dokumentzentriert' },
  'Design + slides': { zh: '设计 + 幻灯片', es: 'Diseño + diapositivas', fr: 'Design + diapositives', de: 'Design + Folien' },
  'Board-first': { zh: '以白板为主', es: 'Orientado a tableros', fr: 'Orienté tableau', de: 'Board-zentriert' },
  'Docs + databases': { zh: '文档 + 数据库', es: 'Documentos + bases de datos', fr: 'Documents + bases de données', de: 'Dokumente + Datenbanken' },
  'Assisted edits': { zh: '辅助编辑', es: 'Edición asistida', fr: 'Édition assistée', de: 'Assistiertes Bearbeiten' },
  'Assisted generation': { zh: '辅助生成', es: 'Generación asistida', fr: 'Génération assistée', de: 'Assistierte Generierung' },
  'Assisted diagrams': { zh: '辅助绘图', es: 'Diagramas asistidos', fr: 'Diagrammes assistés', de: 'Assistierte Diagramme' },
  'Assisted writing': { zh: '辅助写作', es: 'Escritura asistida', fr: 'Rédaction assistée', de: 'Assistiertes Schreiben' },
  'Via integration': { zh: '需借助集成', es: 'Mediante integración', fr: 'Via une intégration', de: 'Über eine Integration' },
  Formulas: { zh: '公式功能', es: 'Fórmulas', fr: 'Formules', de: 'Formeln' },
  'Community assets': { zh: '社区资源', es: 'Recursos de la comunidad', fr: 'Ressources communautaires', de: 'Community-Assets' },
  'Template marketplace': { zh: '模板市场', es: 'Marketplace de plantillas', fr: 'Place de marché de modèles', de: 'Vorlagen-Marktplatz' },
  'Template gallery': { zh: '模板库', es: 'Galería de plantillas', fr: 'Galerie de modèles', de: 'Vorlagengalerie' },
  Prototypes: { zh: '仅原型', es: 'Prototipos', fr: 'Prototypes', de: 'Prototypen' },
  'Published pages': { zh: '仅发布页面', es: 'Páginas publicadas', fr: 'Pages publiées', de: 'Veröffentlichte Seiten' },
  'Team permissions': { zh: '团队权限', es: 'Permisos de equipo', fr: 'Permissions d’équipe', de: 'Team-Berechtigungen' },
  'View-only links': { zh: '仅查看链接', es: 'Enlaces de solo lectura', fr: 'Liens en lecture seule', de: 'Nur-Lese-Links' },
  'Link editing': { zh: '通过链接编辑', es: 'Edición por enlace', fr: 'Édition par lien', de: 'Bearbeiten per Link' },
  'Guest boards': { zh: '访客白板', es: 'Tableros para invitados', fr: 'Tableaux invités', de: 'Gäste-Boards' },
  'Code-first': { zh: '以代码为主', es: 'Orientado a código', fr: 'Orienté code', de: 'Code-zentriert' },
  'AI steps': { zh: 'AI 步骤', es: 'Pasos de IA', fr: 'Étapes IA', de: 'KI-Schritte' },
  'AI modules': { zh: 'AI 模块', es: 'Módulos de IA', fr: 'Modules IA', de: 'KI-Module' },
  'Sub-workflows': { zh: '子工作流', es: 'Subflujos', fr: 'Sous-flux', de: 'Sub-Workflows' },
  Topics: { zh: '主题机制', es: 'Temas', fr: 'Sujets', de: 'Topics' },
  'Consume only': { zh: '仅能调用', es: 'Solo consumir', fr: 'Consommation seule', de: 'Nur nutzen' },
  'Manual step': { zh: '手动步骤', es: 'Paso manual', fr: 'Étape manuelle', de: 'Manueller Schritt' },
  'Wait node': { zh: '等待节点', es: 'Nodo de espera', fr: 'Nœud d’attente', de: 'Warte-Knoten' },
  'Custom code': { zh: '需自行编码', es: 'Código propio', fr: 'Code sur mesure', de: 'Eigener Code' },
  'Tenant policy': { zh: '租户策略', es: 'Política del inquilino', fr: 'Politique du locataire', de: 'Mandanten-Richtlinie' },
  'Task history': { zh: '任务历史', es: 'Historial de tareas', fr: 'Historique des tâches', de: 'Aufgabenverlauf' },
  Executions: { zh: '执行记录', es: 'Ejecuciones', fr: 'Exécutions', de: 'Ausführungen' },
  'Run history': { zh: '运行历史', es: 'Historial de ejecuciones', fr: 'Historique des exécutions', de: 'Ausführungsverlauf' },
  Analytics: { zh: '仅分析报表', es: 'Analíticas', fr: 'Analyses', de: 'Analysen' },
  'Tracing add-on': { zh: '需追踪附加组件', es: 'Complemento de trazas', fr: 'Module de traçage', de: 'Tracing-Zusatzmodul' },
  'Auto-pause': { zh: '自动暂停', es: 'Pausa automática', fr: 'Mise en pause automatique', de: 'Automatische Pause' },
  'Error workflow': { zh: '错误处理工作流', es: 'Flujo de errores', fr: 'Flux d’erreur', de: 'Fehler-Workflow' },
  'Auto-disable': { zh: '自动停用', es: 'Desactivación automática', fr: 'Désactivation automatique', de: 'Automatische Deaktivierung' },
  'Code nodes': { zh: '代码节点', es: 'Nodos de código', fr: 'Nœuds de code', de: 'Code-Knoten' },
  'Build it yourself': { zh: '需自行构建', es: 'Constrúyelo tú mismo', fr: 'À construire soi-même', de: 'Selbst zu bauen' },
  'Own catalog': { zh: '仅自有模型目录', es: 'Catálogo propio', fr: 'Catalogue propre', de: 'Eigener Katalog' },
  'Some providers': { zh: '仅部分厂商', es: 'Algunos proveedores', fr: 'Certains fournisseurs', de: 'Einige Anbieter' },
  'Cloud account': { zh: '需云账号', es: 'Cuenta de nube', fr: 'Compte cloud', de: 'Cloud-Konto' },
  'Self-hosted': { zh: '需自托管', es: 'Autoalojado', fr: 'Auto-hébergé', de: 'Self-Hosting' },
  'Proxy any endpoint': { zh: '可代理任意端点', es: 'Proxy de cualquier endpoint', fr: 'Proxy de n’importe quel endpoint', de: 'Beliebigen Endpunkt proxen' },
  'Price / latency': { zh: '按价格 / 延迟', es: 'Precio / latencia', fr: 'Prix / latence', de: 'Preis / Latenz' },
  'Latency-based': { zh: '基于延迟', es: 'Según la latencia', fr: 'Selon la latence', de: 'Latenzbasiert' },
  'Conditional rules': { zh: '条件规则', es: 'Reglas condicionales', fr: 'Règles conditionnelles', de: 'Bedingte Regeln' },
  'Provider-dependent': { zh: '取决于厂商', es: 'Depende del proveedor', fr: 'Dépend du fournisseur', de: 'Anbieterabhängig' },
  'Per-key credits': { zh: '按密钥计额度', es: 'Créditos por clave', fr: 'Crédits par clé', de: 'Guthaben je Schlüssel' },
  'Virtual keys': { zh: '虚拟密钥', es: 'Claves virtuales', fr: 'Clés virtuelles', de: 'Virtuelle Schlüssel' },
  'Cloud billing': { zh: '走云厂商账单', es: 'Facturación en la nube', fr: 'Facturation cloud', de: 'Cloud-Abrechnung' },
  'Analytics only': { zh: '仅分析报表', es: 'Solo analíticas', fr: 'Analyses uniquement', de: 'Nur Analysen' },
  'Metadata tags': { zh: '元数据标签', es: 'Etiquetas de metadatos', fr: 'Étiquettes de métadonnées', de: 'Metadaten-Tags' },
  'Custom properties': { zh: '自定义属性', es: 'Propiedades personalizadas', fr: 'Propriétés personnalisées', de: 'Eigene Eigenschaften' },
  'Freelancer profiles': { zh: '自由职业者主页', es: 'Perfiles de freelancers', fr: 'Profils de freelances', de: 'Freelancer-Profile' },
  'Gig listings': { zh: '服务列表', es: 'Anuncios de servicios', fr: 'Annonces de prestations', de: 'Gig-Angebote' },
  'Vetted profiles': { zh: '经审核的人才主页', es: 'Perfiles verificados', fr: 'Profils sélectionnés', de: 'Geprüfte Profile' },
  'Basic tracker': { zh: '基础工单跟踪', es: 'Rastreador básico', fr: 'Suivi basique', de: 'Einfacher Tracker' },
  "The agency's own": { zh: '各代理商自有工具', es: 'El de la propia agencia', fr: 'Celui de l’agence', de: 'Das der Agentur' },
  Milestones: { zh: '里程碑机制', es: 'Hitos', fr: 'Jalons', de: 'Meilensteine' },
  'Order review': { zh: '订单验收', es: 'Revisión del pedido', fr: 'Revue de commande', de: 'Bestellprüfung' },
  'Contract terms': { zh: '按合同约定', es: 'Condiciones del contrato', fr: 'Termes du contrat', de: 'Vertragsbedingungen' },
  '0% under the threshold': { zh: '门槛以下 0% 抽成', es: '0 % por debajo del umbral', fr: '0 % sous le seuil', de: '0 % unterhalb der Schwelle' },
  // Matches the wording already used for this cell in the agentic arena.
  'See vendor pricing': { zh: '见厂商定价', es: 'Consulta el precio del proveedor', fr: 'Voir le tarif de l’éditeur', de: 'Siehe Anbieterpreise' },
  Negotiated: { zh: '需另行商议', es: 'Negociado', fr: 'Négocié', de: 'Verhandelbar' },
  'Project catalog': { zh: '项目化服务目录', es: 'Catálogo de proyectos', fr: 'Catalogue de projets', de: 'Projektkatalog' },
  Gigs: { zh: '服务商品', es: 'Servicios', fr: 'Prestations', de: 'Gigs' },
};

/** Leading verdict glyphs. A cell is `<glyph>` or `<glyph> <qualifier>`. */
const GLYPHS = ['✅', '⚠️', '❌'];

function tr(locale, text) {
  if (locale === 'en') return text;
  const hit = T[text];
  if (!hit?.[locale]) throw new Error(`No ${locale} translation for: ${JSON.stringify(text)}`);
  return hit[locale];
}

/** Translate a cell, leaving its verdict glyph alone. */
function trCell(locale, value) {
  if (locale === 'en') return value;
  const glyph = GLYPHS.find((g) => value.startsWith(g));
  if (!glyph) return tr(locale, value);
  const qualifier = value.slice(glyph.length).trim();
  return qualifier ? `${glyph} ${tr(locale, qualifier)}` : glyph;
}

function trCategories(locale, categories) {
  return categories.map((category) => ({
    id: category.id,
    title: tr(locale, category.title),
    blurb: tr(locale, category.blurb),
    rows: category.rows.map((row) => ({
      feature: tr(locale, row.feature),
      ...(row.note ? { note: tr(locale, row.note) } : {}),
      values: Object.fromEntries(Object.entries(row.values).map(([key, value]) => [key, trCell(locale, value)])),
    })),
  }));
}

for (const locale of LOCALES) {
  const file = resolve(messagesDir, `${locale}.json`);
  const catalog = JSON.parse(readFileSync(file, 'utf8'));
  const compare = catalog.compare;

  // The agentic categories are MOVED, not re-authored — already translated, and
  // re-running the script must not lose them once `compare.categories` is gone.
  const agenticCategories = compare.categories ?? compare.arenas?.agentic?.categories;
  if (!agenticCategories) throw new Error(`${locale}: no compare.categories to migrate`);
  delete compare.categories;

  const arenas = { agentic: { ...ARENA_LABELS.agentic, categories: agenticCategories } };
  for (const [key, categories] of Object.entries(NEW_ARENA_CATEGORIES)) {
    arenas[key] = { ...ARENA_LABELS[key], categories };
  }
  for (const arena of Object.values(arenas)) {
    arena.label = tr(locale, arena.label);
    arena.blurb = tr(locale, arena.blurb);
  }
  for (const key of Object.keys(NEW_ARENA_CATEGORIES)) {
    arenas[key].categories = trCategories(locale, NEW_ARENA_CATEGORIES[key]);
  }

  compare.arenas = arenas;
  compare.arenaTabsLabel = tr(locale, ARENA_TABS_LABEL);
  compare.competitorLabels = { ...compare.competitorLabels, ...NEW_COMPETITOR_LABELS };

  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const rows = Object.values(arenas).reduce((n, a) => n + a.categories.reduce((m, c) => m + c.rows.length, 0), 0);
  console.log(`${locale}: ${Object.keys(arenas).length} arenas, ${rows} rows, +${Object.keys(NEW_COMPETITOR_LABELS).length} vendor labels`);
}
