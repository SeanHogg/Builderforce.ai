/**
 * One starter toolkit per business stage, sold as an ordinary `pack`.
 *
 * A pack is a whole board (`from: []`), checked by the system harness and
 * installed by copying its publication snapshot onto a new session. These five
 * listings are not a new family and they are not the replay-pack credit economy:
 * they are `kind: 'pack'` rows written by `publishCreationListing`, so Stage,
 * the public feed and install are the same code every other pack uses.
 *
 * There is no platform tenant, and a publication snapshot cannot be written
 * without one (`snapshots.tenant_id` is NOT NULL and foreign-keyed). The seed
 * is therefore a call, not a migration: the first founder who needs a missing
 * stage publishes the five boards into their own tenant. Later founders find
 * those public rows. Re-running the seed is a no-op once each stage's tag is
 * already on the feed.
 */
import { desc } from 'drizzle-orm';
import {
  BUSINESS_STAGES,
  isBusinessStage,
  type BusinessStage,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  companies,
  creationSessionObjects,
  creationSessions,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { creationObjectSearchText } from '../creation/creationGraphWriter';
import {
  ListingError,
  browseCreationListings,
  installListingIntoCanvas,
  publishCreationListing,
  type CreationListingView,
} from './creationListings';

/**
 * Marks a pack as a stage toolkit. The stage itself is a second tag, one of
 * `BUSINESS_STAGES` — not the advisor `start|grow|exit` vocabulary.
 */
export const STAGE_TOOLKIT_TAG = 'stage-toolkit';

/**
 * Phrase every toolkit name carries.
 *
 * The public browse feed filters on kind and free text, not on tags, and it
 * caps a page at 48. Searching this phrase keeps the five toolkits on that
 * page; the tag is what actually decides the stage, so a pack that merely
 * mentions the phrase is not a toolkit.
 */
export const STAGE_TOOLKIT_QUERY = 'starter toolkit';

/** The feed's own cap. Asking for more is silently clamped, which would miss
 *  a key and serve a stale page. */
const BROWSE_LIMIT = 48;

export interface StageToolkitSpec {
  stage: BusinessStage;
  name: string;
  summary: string;
  instructions: string;
  setupInstructions: string;
  steps: ReadonlyArray<{ title: string; detail: string }>;
}

const SPECS: readonly StageToolkitSpec[] = [
  {
    stage: 'idea',
    name: 'Idea starter toolkit',
    summary: 'A starter toolkit for a founder who has a problem and not yet a product.',
    instructions: 'Name the person who has the problem, the workaround they use today, and the one sentence you would not be embarrassed to say out loud. Do not pick a technology yet.',
    setupInstructions: 'Fill the three steps before you talk to anyone about a build.',
    steps: [
      { title: 'Who hurts', detail: 'One person, not a market. What they do the week this problem shows up.' },
      { title: 'The workaround', detail: 'The spreadsheet, the hire, or the habit they already pay for.' },
      { title: 'The sentence', detail: 'What you are building, in words a stranger can repeat.' },
    ],
  },
  {
    stage: 'mvp',
    name: 'MVP starter toolkit',
    summary: 'A starter toolkit for a founder shipping the smallest thing a stranger can use.',
    instructions: 'Cut the product to one job a stranger can finish without you in the room. Everything else is a later pack.',
    setupInstructions: 'Ship the one job before you add a second.',
    steps: [
      { title: 'The one job', detail: 'The action a stranger completes. If it needs a call with you, it is not the job.' },
      { title: 'Out of scope', detail: 'Write down what you will not build this month, so it stops leaking into the board.' },
      { title: 'The first user', detail: 'Who will try it this week, and how you will know they finished.' },
    ],
  },
  {
    stage: 'early_revenue',
    name: 'Early-revenue starter toolkit',
    summary: 'A starter toolkit for a founder who has been paid and needs that to happen again.',
    instructions: 'Write down who paid, why they paid, and the next three people who look like them. A second sale is the product now.',
    setupInstructions: 'Do not add a feature until you can name the next buyer.',
    steps: [
      { title: 'Who paid', detail: 'The customer, the amount, and the sentence they used when they said yes.' },
      { title: 'Why they paid', detail: 'The pain that was expensive enough. Not the feature they complimented.' },
      { title: 'The next three', detail: 'Names, not a segment. How you will reach each one.' },
    ],
  },
  {
    stage: 'growth',
    name: 'Growth starter toolkit',
    summary: 'A starter toolkit for a founder whose repeatable sale now has to survive without them.',
    instructions: 'Separate the sale you can repeat from the sale that only works when you are in the room. Hire and spend against the first one.',
    setupInstructions: 'Write the repeatable sale before you open a role.',
    steps: [
      { title: 'The motion', detail: 'How a buyer finds you, decides, and pays, in the order it actually happens.' },
      { title: 'What only you can do', detail: 'The steps that stall when you are away. Those are the ones to hand off or delete.' },
      { title: 'The constraint', detail: 'The one limit (leads, delivery, cash) that caps this quarter.' },
    ],
  },
  {
    stage: 'scale',
    name: 'Scale starter toolkit',
    summary: 'A starter toolkit for a founder whose company has to run as a system, not as a hero.',
    instructions: 'Name the operating cadence, the numbers the room looks at, and the decision you will stop making yourself.',
    setupInstructions: 'Pick the cadence before you add another dashboard.',
    steps: [
      { title: 'The cadence', detail: 'What is reviewed weekly, and who is in the room when you are not.' },
      { title: 'The numbers', detail: 'The few figures that would change a decision this month. Drop the rest.' },
      { title: 'The handoff', detail: 'One decision you will stop making, and the person who now owns it.' },
    ],
  },
];

export function stageToolkitSpecs(): readonly StageToolkitSpec[] {
  return SPECS;
}

/** The card a toolkit publishes. One note, no executable step kinds, no bindings
 *  that Stage would strip or refuse. */
export function stageToolkitCard(spec: StageToolkitSpec): {
  id: string;
  kind: string;
  canvasData: Record<string, never>;
  content: Record<string, unknown>;
} {
  return {
    id: `stage-toolkit-${spec.stage}`,
    kind: 'note',
    canvasData: {},
    content: {
      title: spec.name,
      stage: spec.stage,
      instructions: spec.instructions,
      setupInstructions: spec.setupInstructions,
      steps: spec.steps.map((step) => ({ title: step.title, detail: step.detail })),
    },
  };
}

/** The stage a toolkit listing is for, or null when the row is some other pack. */
export function stageOfToolkit(tags: readonly string[] | null | undefined): BusinessStage | null {
  if (!tags?.includes(STAGE_TOOLKIT_TAG)) return null;
  return BUSINESS_STAGES.find((stage) => tags.includes(stage)) ?? null;
}

/** The company's stage, newest company first. Null when unset or unrecognised. */
export async function founderBusinessStage(db: Db, tenantId: number): Promise<BusinessStage | null> {
  const [company] = await db
    .select({ businessStage: companies.businessStage })
    .from(companies)
    .where(scopedToTenant(companies, tenantId))
    .orderBy(desc(companies.updatedAt))
    .limit(1);
  return isBusinessStage(company?.businessStage) ? company.businessStage : null;
}

/** The public pack for this stage, or null when nobody has published it yet. */
export async function findStagePack(
  db: Db,
  env: Env,
  stage: BusinessStage,
): Promise<CreationListingView | null> {
  const page = await browseCreationListings(db, env, {
    kind: 'pack',
    q: STAGE_TOOLKIT_QUERY,
    limit: BROWSE_LIMIT,
  });
  return page.listings.find((listing) => stageOfToolkit(listing.tags) === stage) ?? null;
}

/**
 * Publish any stage whose toolkit is not already on the public feed.
 *
 * Goes through `publishCreationListing` — Stage runs, a publication snapshot
 * is written, and the row is an ordinary pack. A stage already tagged is left
 * alone, so a second call does not open a second URL.
 */
export async function ensureStageToolkits(
  db: Db,
  env: Env,
  publisher: { tenantId: number; userId: string },
): Promise<CreationListingView[]> {
  const page = await browseCreationListings(db, env, {
    kind: 'pack',
    q: STAGE_TOOLKIT_QUERY,
    limit: BROWSE_LIMIT,
  });
  const found = new Map<BusinessStage, CreationListingView>();
  for (const listing of page.listings) {
    const stage = stageOfToolkit(listing.tags);
    if (stage && !found.has(stage)) found.set(stage, listing);
  }

  const views: CreationListingView[] = [];
  for (const spec of SPECS) {
    const existing = found.get(spec.stage);
    if (existing) {
      views.push(existing);
      continue;
    }
    views.push(await publishToolkit(db, env, publisher, spec));
  }
  return views;
}

async function publishToolkit(
  db: Db,
  env: Env,
  publisher: { tenantId: number; userId: string },
  spec: StageToolkitSpec,
): Promise<CreationListingView> {
  const card = stageToolkitCard(spec);
  const [session] = await db
    .insert(creationSessions)
    .values({
      tenantId: publisher.tenantId,
      title: spec.name,
      description: spec.summary,
      createdBy: publisher.userId,
      updatedBy: publisher.userId,
      canvasRevision: 1,
    })
    .returning({ id: creationSessions.id });
  if (!session) throw new ListingError('Could not open a board for the starter toolkit', 400);

  // The column is a uuid. The card's stable id is only a label for Stage; using
  // it here would be rejected by Postgres the first time a founder seeded.
  await db.insert(creationSessionObjects).values({
    id: crypto.randomUUID(),
    sessionId: session.id,
    kind: card.kind,
    canvasData: card.canvasData,
    content: card.content,
    searchText: creationObjectSearchText(card.content),
    createdBy: publisher.userId,
    updatedBy: publisher.userId,
  });

  // objectId null: a pack is the whole board, which is the only shape `pack` accepts.
  return publishCreationListing(db, env, {
    tenantId: publisher.tenantId,
    userId: publisher.userId,
    sessionId: session.id,
    objectId: null,
    kind: 'pack',
    name: spec.name,
    summary: spec.summary,
    category: 'toolkit',
    tags: [STAGE_TOOLKIT_TAG, spec.stage],
    priceCents: 0,
  });
}

/**
 * Install the toolkit for a founder's stage onto a new board of their own.
 *
 * `stage` may be passed by a caller that already resolved it. Omitted, it is
 * read from the company. A missing toolkit is published first — that is the
 * seed — and then installed through `installListingIntoCanvas`, the same copy
 * path every other pack uses. This function does not grant a licence; a free
 * pack needs none, and a paid one is the route's job.
 */
export async function installStagePack(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; stage?: string | null },
): Promise<{ sessionId: string; title: string; objectCount: number; slug: string; stage: BusinessStage }> {
  const stage = isBusinessStage(input.stage) ? input.stage : await founderBusinessStage(db, input.tenantId);
  if (!stage) {
    throw new ListingError('Set a business stage on the company before installing a starter toolkit', 400);
  }

  let pack = await findStagePack(db, env, stage);
  if (!pack) {
    await ensureStageToolkits(db, env, { tenantId: input.tenantId, userId: input.userId });
    pack = await findStagePack(db, env, stage);
  }
  if (!pack) throw new ListingError(`No starter toolkit is published for ${stage}`, 404);

  const installed = await installListingIntoCanvas(db, env, {
    tenantId: input.tenantId,
    userId: input.userId,
    slug: pack.slug,
  });
  return { ...installed, slug: pack.slug, stage };
}
