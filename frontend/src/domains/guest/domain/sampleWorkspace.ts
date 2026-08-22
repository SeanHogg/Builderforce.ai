/**
 * THE SAMPLE WORKSPACE — one dataset, for every surface a signed-out visitor
 * can now open.
 *
 * ── WHY ONE, AND WHY HERE ────────────────────────────────────────────────────
 * A chart with no rows teaches nothing. Once the app routes render for everyone
 * (`isGuestPreviewRoute`), the surfaces that exist to be LOOKED at — the Insights
 * lenses, the boards, the workforce — need something true to draw, or the change
 * swaps a marketing page for an empty grid and makes the product look dead.
 *
 * It replaces FIVE seeded server tenants (migration 0360's persona demos). Those
 * were a shared workspace a visitor borrowed, could not keep, and that a nightly
 * reseed wiped — the visitor's edits destroyed by design, which is the opposite
 * of the conversion they existed for. This dataset is seeded into the visitor's
 * OWN session instead: they edit it, it is theirs, and signing up links the work
 * they authored rather than discarding it.
 *
 * ── THE THREE PROPERTIES THAT MAKE IT HONEST ─────────────────────────────────
 *  1. It always says what it is. Every surface reading it renders
 *     `<SampleDataNotice>`, which decides its own visibility and disappears the
 *     moment the surface is reading real rows.
 *  2. It is EDITABLE. A number you can drag is the demo; a screenshot is not.
 *     Edits land in the guest session store as overlays on these rows.
 *  3. It is keyed by BUILD ID. A deploy replaces the fixture rather than leaving
 *     last month's shape in somebody's browser to fail against this month's
 *     code — see `guestSessionStore`.
 *
 * ── WHAT LIVES HERE AND WHAT DOES NOT ────────────────────────────────────────
 * Domain shapes only: entities in the product's own vocabulary, with no HTTP in
 * sight. Turning these into the exact JSON each endpoint answers is the
 * infrastructure layer's job (`infrastructure/fixtures/*`), because that is
 * where a wire contract belongs and where it must change when an endpoint does.
 *
 * Dates are expressed as OFFSETS IN DAYS, never as literals. A fixture with
 * hard-coded ISO dates is fresh on the day it is written and visibly stale
 * forever after — "a board mid-sprint" whose sprint ended in March reads as an
 * abandoned product. `dayOffset` is resolved against the read's own clock.
 */

/** Days before (negative) or after (positive) the moment the fixture is read. */
export type DayOffset = number;

export type SampleTaskStatus = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done' | 'blocked';

export interface SampleTask {
  key: string;
  title: string;
  description?: string;
  status: SampleTaskStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  /** Which sample member owns it — an agent slug or `'human'`. */
  assignee: string;
  points?: number;
  epic?: boolean;
  parentKey?: string;
  createdDayOffset: DayOffset;
  completedDayOffset?: DayOffset;
  dueDayOffset?: DayOffset;
}

export interface SampleProject {
  id: number;
  key: string;
  name: string;
  description: string;
  status: 'active' | 'planning' | 'paused';
  createdDayOffset: DayOffset;
  tasks: SampleTask[];
}

export interface SampleMember {
  slug: string;
  name: string;
  title: string;
  /** `agent` rows render with the agent badge; `human` is the visitor's seat. */
  kind: 'agent' | 'human';
  skills: string[];
  /** Runs completed in the trailing window — feeds the workforce and AI lenses. */
  runsPerDay: number;
}

/** One day of the trailing series every time-windowed lens draws. */
export interface SampleDailyPoint {
  dayOffset: DayOffset;
  /** Tasks moved to a completed status that day. */
  completed: number;
  /** Pull requests merged that day. */
  merged: number;
  /** Model calls made by the workforce that day. */
  runs: number;
  /** Platform spend in CENTS for that day — money is integer cents everywhere. */
  spendCents: number;
  /** Model tokens consumed that day. */
  tokens: number;
}

// ---------------------------------------------------------------------------
// The dataset
// ---------------------------------------------------------------------------

/**
 * The workspace's name. Suffixed "(Sample)" in every locale-independent place it
 * appears — the tenant switcher, a page title, an export — so the label is not
 * carried by the banner alone. A visitor who screenshots one card still
 * screenshots something that says what it is.
 */
export const SAMPLE_WORKSPACE_NAME = 'Nova Commerce (Sample)';

/** The id the guest workspace reports. Never numeric: a numeric id would collide
 *  with a real tenant id in any cache keyed by workspace. */
export const SAMPLE_TENANT_ID = 'sample';

export const SAMPLE_MEMBERS: SampleMember[] = [
  {
    slug: 'atlas',
    name: 'Atlas',
    title: 'AI Software Engineer',
    kind: 'agent',
    skills: ['typescript', 'react', 'api-design', 'testing', 'refactoring'],
    runsPerDay: 9,
  },
  {
    slug: 'vega',
    name: 'Vega',
    title: 'AI Code Reviewer',
    kind: 'agent',
    skills: ['code-review', 'testing', 'security', 'conventions'],
    runsPerDay: 6,
  },
  {
    slug: 'juno',
    name: 'Juno',
    title: 'AI Delivery Manager',
    kind: 'agent',
    skills: ['planning', 'triage', 'reporting'],
    runsPerDay: 3,
  },
  {
    slug: 'human',
    name: 'You',
    title: 'Product lead',
    kind: 'human',
    skills: [],
    runsPerDay: 0,
  },
];

export const SAMPLE_PROJECTS: SampleProject[] = [
  {
    id: 9001,
    key: 'SHOP',
    name: 'Storefront Platform',
    description:
      'Catalog, cart, checkout and order tracking. People and agents share this board — drag a ticket to Ready and an agent picks it up.',
    status: 'active',
    createdDayOffset: -96,
    tasks: [
      { key: 'SHOP-1', title: 'Checkout revamp', description: 'Rebuild the checkout flow for conversion — fewer steps, saved payment methods, express wallets.', status: 'in_progress', priority: 'high', assignee: 'human', epic: true, createdDayOffset: -34 },
      { key: 'SHOP-2', title: 'Apple Pay and Google Pay express checkout', description: 'Wire the payment-request API into the cart behind a feature flag. One-tap purchase on supported devices.', status: 'in_progress', priority: 'high', assignee: 'atlas', points: 5, parentKey: 'SHOP-1', createdDayOffset: -12, dueDayOffset: 3 },
      { key: 'SHOP-3', title: 'Persist the cart across devices', description: 'Move cart state server-side keyed by account; merge the anonymous cart on sign-in.', status: 'in_review', priority: 'medium', assignee: 'atlas', points: 3, parentKey: 'SHOP-1', createdDayOffset: -9 },
      { key: 'SHOP-4', title: 'Rounding error in multi-currency totals', description: 'Totals drift by a cent when the display currency differs from the charge currency. Root cause: summing after conversion.', status: 'done', priority: 'urgent', assignee: 'atlas', points: 2, createdDayOffset: -6, completedDayOffset: -1 },
      { key: 'SHOP-5', title: 'Order-status email notifications', description: 'Transactional mail on paid, shipped and delivered, with locale-aware templates.', status: 'done', priority: 'medium', assignee: 'atlas', points: 3, parentKey: 'SHOP-1', createdDayOffset: -11, completedDayOffset: -3 },
      { key: 'SHOP-6', title: 'Lazy-load reviews on the product page', description: 'Reviews block first paint on long pages. Defer below the fold and hydrate on scroll.', status: 'done', priority: 'medium', assignee: 'human', points: 2, createdDayOffset: -14, completedDayOffset: -5 },
      { key: 'SHOP-7', title: 'Low-stock badge on listing cards', status: 'ready', priority: 'low', assignee: 'human', points: 1, createdDayOffset: -4 },
      { key: 'SHOP-8', title: 'Gift-card redemption at checkout', status: 'ready', priority: 'medium', assignee: 'human', points: 5, createdDayOffset: -4 },
      { key: 'SHOP-9', title: 'Abandoned-cart recovery sequence', status: 'backlog', priority: 'medium', assignee: 'human', points: 8, createdDayOffset: -2 },
      { key: 'SHOP-10', title: 'Warehouse API rate limit blocks nightly sync', description: 'The supplier caps us at 60 requests a minute and the nightly job needs 400. Waiting on their support.', status: 'blocked', priority: 'high', assignee: 'atlas', points: 3, createdDayOffset: -8 },
    ],
  },
  {
    id: 9002,
    key: 'PLAT',
    name: 'Platform Reliability',
    description: 'Error budget, incident response and the checks that keep the storefront up during a launch.',
    status: 'active',
    createdDayOffset: -62,
    tasks: [
      { key: 'PLAT-1', title: 'Alert on checkout error-rate spike', status: 'done', priority: 'urgent', assignee: 'atlas', points: 3, createdDayOffset: -20, completedDayOffset: -9 },
      { key: 'PLAT-2', title: 'Replay failed webhooks from the dead-letter queue', status: 'in_progress', priority: 'high', assignee: 'atlas', points: 5, createdDayOffset: -7, dueDayOffset: 5 },
      { key: 'PLAT-3', title: 'Cut image build time below four minutes', status: 'ready', priority: 'medium', assignee: 'human', points: 5, createdDayOffset: -3 },
      { key: 'PLAT-4', title: 'Document the on-call escalation path', status: 'backlog', priority: 'low', assignee: 'human', points: 2, createdDayOffset: -3 },
    ],
  },
  {
    id: 9003,
    key: 'GROW',
    name: 'Growth Experiments',
    description: 'Pricing page tests, lifecycle mail and the attribution the finance lens reads from.',
    status: 'planning',
    createdDayOffset: -28,
    tasks: [
      { key: 'GROW-1', title: 'Pricing page A/B: annual default', status: 'in_progress', priority: 'medium', assignee: 'human', points: 3, createdDayOffset: -10 },
      { key: 'GROW-2', title: 'Win-back sequence for lapsed carts', status: 'ready', priority: 'medium', assignee: 'human', points: 5, createdDayOffset: -5 },
      { key: 'GROW-3', title: 'Attribution: first touch vs last touch', status: 'backlog', priority: 'low', assignee: 'human', points: 8, createdDayOffset: -5 },
    ],
  },
];

/**
 * The trailing 30 days, generated rather than typed out.
 *
 * Typed-out series are the other way a fixture goes stale: thirty literal rows
 * are thirty chances for a number nobody re-reads. This is a shaped curve —
 * a working week that dips at the weekend, a gentle upward trend, and one
 * deliberate spike so the delivery lens has an anomaly worth pointing at.
 */
export function sampleDailySeries(days = 30): SampleDailyPoint[] {
  const series: SampleDailyPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayOffset = -i;
    // Day of week from the offset: weekends are quiet, which is what makes the
    // weekday numbers legible rather than a flat band.
    const weekend = ((i % 7) === 2) || ((i % 7) === 3);
    const trend = (days - i) / days;
    const spike = i === 9 ? 2.4 : 1;
    const base = weekend ? 0.25 : 1;
    const completed = Math.round(base * spike * (2 + trend * 3));
    const merged = Math.round(base * spike * (1 + trend * 3));
    const runs = Math.round(base * spike * (14 + trend * 10));
    series.push({
      dayOffset,
      completed,
      merged,
      runs,
      // Roughly a third of a cent per thousand tokens, expressed in whole cents.
      spendCents: runs * 37,
      tokens: runs * 4200,
    });
  }
  return series;
}

/** Every sample task, flattened, with the project it belongs to. */
export function sampleTasks(): Array<SampleTask & { projectId: number; projectKey: string; projectName: string }> {
  return SAMPLE_PROJECTS.flatMap((project) =>
    project.tasks.map((task) => ({
      ...task,
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
    })),
  );
}

/** The statuses that count as finished, shared by every roll-up below so a
 *  "completed" total cannot mean two things on two surfaces. */
const COMPLETED: ReadonlySet<SampleTaskStatus> = new Set<SampleTaskStatus>(['done']);

export function isSampleTaskCompleted(status: SampleTaskStatus): boolean {
  return COMPLETED.has(status);
}
