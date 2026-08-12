import { describe, expect, it } from 'vitest';
import {
  FOOTER_COLUMNS,
  LEARN_COLUMNS,
  NAV_GROUPS,
  PANEL_SURFACES,
  PRODUCT_COLUMNS,
  PUBLIC_DESTINATIONS,
  PUBLIC_NAV,
  REFERENCE_DESTINATIONS,
  REFERENCE_DOMAINS,
  REFERENCE_FOUNDATIONS,
  RUNG,
  STAGES,
  bottomNavFor,
  columnOf,
  destTitleKey,
  earnedRung,
  footerColumns,
  groupsForStage,
  publicById,
  publicDestinationFor,
  referenceByHref,
  referenceBySlug,
} from './navGroups';
import { FAMILIES, FAMILY_IDS, resolveFamily } from './marketplaceFamilies';
import { SEATS, isSeat, seatHueVar } from './seats';
import { classifyShell, isReferenceSurface, rendersAppShell } from './shellRouting';
import { classifyRoute, panelWidth } from './workbenchPolicy';

/**
 * The unified menu's acceptance criteria (PRD 21 §11.8), as assertions.
 *
 * `check-destinations.mjs` guards the STRUCTURE — one declaration site, no
 * duplicate labels, every seat with a hue. These guard the BEHAVIOUR the
 * structure is supposed to produce, which a source scan cannot see.
 */

describe('the arc — every destination sits in exactly one stage', () => {
  it('places every row in a declared stage', () => {
    for (const group of NAV_GROUPS) {
      expect(STAGES, `${group.id} has an unknown stage`).toContain(group.stage);
    }
  });

  it('covers the whole registry when the stages are summed', () => {
    const placed = STAGES.flatMap((stage) => groupsForStage(NAV_GROUPS, stage));
    expect(placed).toHaveLength(NAV_GROUPS.length);
  });

  /** The arc, in order. `expand` joined it between Market and Admin: MARKET puts
   *  the product in front of people, EXPAND grows the business off the back of it
   *  (the referral/associate programme), and ADMIN is not a step in the arc at
   *  all — it is where you go to change settings. */
  it('renders Idea → Make → Run before Measure, Market, Expand and Admin', () => {
    expect(STAGES).toEqual(['idea', 'make', 'run', 'measure', 'market', 'expand', 'admin']);
  });

  it('gives the RUN group one row per business seat, each owned by a teammate', () => {
    const run = groupsForStage(NAV_GROUPS, 'run');
    expect(run.length).toBeGreaterThanOrEqual(8);
    for (const row of run) {
      expect(isSeat(row.seat), `${row.id} is a RUN row with no teammate behind it`).toBe(true);
    }
  });
});

describe('the seat is the teammate, and it is not also a menu', () => {
  it('no longer ships a `seat` or `dashboard` destination', () => {
    // `/seat/delivery` as a menu item was a door labelled *door*, and a
    // Dashboard row is what undoes §6.8's land-on-your-last-board.
    const ids = NAV_GROUPS.map((g) => g.id);
    expect(ids).not.toContain('seat');
    expect(ids).not.toContain('dashboard');
  });

  it('gives every seat a hue variable and never shares one between two seats', () => {
    const hues = SEATS.map((seat) => seatHueVar(seat));
    expect(new Set(hues).size).toBe(SEATS.length);
  });

  it('uses only seats the roster knows about', () => {
    for (const group of NAV_GROUPS) {
      if (!isSeat(group.seat)) continue;
      expect(SEATS, `${group.id} names a seat nobody sits in`).toContain(group.seat);
    }
  });
});

describe('progressive disclosure gates state, never visibility', () => {
  it('climbs public → signed in → workspace', () => {
    expect(earnedRung(false, false)).toBe(RUNG.PUBLIC);
    expect(earnedRung(true, false)).toBe(RUNG.SIGNED_IN);
    expect(earnedRung(true, true)).toBe(RUNG.WORKSPACE);
  });

  it('leaves the canvas and the marketplace reachable with no account', () => {
    const publicRows = NAV_GROUPS.filter((g) => g.rung === RUNG.PUBLIC).map((g) => g.id);
    expect(publicRows).toContain('create');
    expect(publicRows).toContain('marketplace');
  });
});

describe('no in-app destination points at a marketing page', () => {
  const marketingHrefs = new Set(REFERENCE_DESTINATIONS.map((r) => r.marketingHref));

  it('keeps every NAV_GROUPS href out of the reference set', () => {
    // The exact bug: the authenticated rail rendered nine C-suite rows that
    // navigated OUT of the product into `/business-intelligence` and friends.
    for (const group of NAV_GROUPS) {
      expect(marketingHrefs.has(group.href), `${group.id} → ${group.href} is an explainer`).toBe(false);
    }
  });

  it('points every reference row at a real in-app destination', () => {
    const appHrefs = new Set(NAV_GROUPS.map((g) => g.href));
    for (const entry of REFERENCE_DESTINATIONS) {
      const base = entry.appHref.split('?')[0];
      const reachable = appHrefs.has(entry.appHref) || appHrefs.has(base)
        || NAV_GROUPS.some((g) => g.match.some((m) => base === m || base.startsWith(`${m}/`)));
      expect(reachable, `${entry.id} hands off to ${entry.appHref}, which no destination owns`).toBe(true);
    }
  });

  it('splits the reference rows into nine domains and three foundations', () => {
    expect(REFERENCE_DOMAINS).toHaveLength(9);
    expect(REFERENCE_FOUNDATIONS).toHaveLength(3);
    expect(REFERENCE_DESTINATIONS).toHaveLength(12);
  });

  it('resolves a reference page by its public slug', () => {
    expect(referenceBySlug('business-intelligence')?.seat).toBe('CFO');
    expect(referenceBySlug('companies-contacts')?.kind).toBe('foundation');
    expect(referenceBySlug('not-a-page')).toBeUndefined();
  });
});

describe('a reference page is a panel when you are signed in', () => {
  it('recognises the explainer surfaces', () => {
    expect(isReferenceSurface('/soc2')).toBe(true);
    expect(isReferenceSurface('/integrations')).toBe(true);
    expect(isReferenceSurface('/survival-focused-agile')).toBe(true);
    expect(isReferenceSurface('/projects')).toBe(false);
  });

  it('opens them as a workbench panel rather than replacing the stage', () => {
    // Acceptance criterion 1: opening a destination must not unmount the canvas.
    expect(classifyRoute('/soc2')).toBe('workbench');
    expect(classifyRoute('/integrations')).toBe('workbench');
  });

  it('opens them at full width, since they were written as full-bleed pages', () => {
    expect(panelWidth('/soc2')).toBe('full');
    expect(panelWidth('/settings')).toBe('sheet');
  });
});

describe('a public page is public — the regression that made the product map invisible', () => {
  // `/features` and the nine domain explainers were reference surfaces in
  // `shellRouting` but absent from `PUBLIC_SHELL_PREFIXES`, so `classifyShell`
  // called them app routes: a signed-out visitor got "This is part of
  // Builderforce.ai" instead of the page, and every marketing surface the
  // Product menu points at was unreachable and unindexable.
  const PUBLIC_PAGES = ['/features', '/product-management', '/business-intelligence', '/companies-contacts', '/soc2', '/integrations', '/survival-focused-agile'];

  it.each(PUBLIC_PAGES)('renders %s to a signed-out visitor', (href) => {
    expect(classifyShell(href)).toBe('public');
    expect(rendersAppShell(href, false)).toBe(false);
  });

  it.each(PUBLIC_PAGES)('opens %s over the board once signed in', (href) => {
    expect(rendersAppShell(href, true)).toBe(true);
    expect(classifyRoute(href)).toBe('workbench');
  });

  it('never lists a panel surface that no public row declares', () => {
    for (const href of PANEL_SURFACES) {
      expect(referenceByHref(href) ?? publicDestinationFor(href), `${href} is a panel with no row`).toBeTruthy();
    }
  });

  it('keeps the canvas out of the panel set — it is what panels open over', () => {
    expect(PANEL_SURFACES).not.toContain('/create/new');
    expect(isReferenceSurface('/create/new')).toBe(false);
  });
});

describe('the public menus and the footer are projections, not lists', () => {
  it('fills every Product and Learn column', () => {
    for (const column of [...PRODUCT_COLUMNS, ...LEARN_COLUMNS]) {
      expect(columnOf(column).length, `the ${column} column is empty`).toBeGreaterThan(0);
    }
  });

  it('groups the Product menu by the same arc the left panel uses', () => {
    // Somebody who reads the marketing menu and then signs up should find the
    // shape they were shown, not a second vocabulary.
    expect(PRODUCT_COLUMNS.every((column) => STAGES.includes(column as never))).toBe(true);
  });

  it('resolves every footer id to a real destination', () => {
    for (const column of footerColumns()) {
      expect(column.links.length, `${column.titleKey} resolved to nothing`).toBeGreaterThan(0);
    }
    const ids = FOOTER_COLUMNS.flatMap((column) => column.ids);
    expect(ids.every((id) => publicById(id))).toBe(true);
  });

  it('no longer offers an /agents destination anywhere public', () => {
    // An agent is a marketplace listing. The footer kept the door open for a
    // release after the destination was folded into the storefront.
    expect(PUBLIC_DESTINATIONS.map((entry) => entry.marketingHref)).not.toContain('/agents');
  });

  it('gives the storefront ONE name across the bar, the footer and the rail', () => {
    const storefront = publicById('marketplace');
    expect(storefront?.marketingHref).toBe('/marketplace');
    expect(FOOTER_COLUMNS.flatMap((column) => column.ids)).toContain('marketplace');
    // Same row, so the label cannot be "Workforce Registry" in one place.
    expect(destTitleKey(storefront!)).toBe('marketingNav.dest.marketplace.title');
  });

  it('gives every menu row a unique public URL', () => {
    const hrefs = PUBLIC_DESTINATIONS.map((entry) => entry.marketingHref);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('the public header has no second Home and no signup wall', () => {
  it('omits a Home row — the logo is home', () => {
    expect(PUBLIC_NAV.map((l) => l.marketingHref)).not.toContain('/');
  });

  it('routes the storefront through one entry rather than four', () => {
    const hrefs = PUBLIC_NAV.map((l) => l.marketingHref);
    expect(hrefs).toContain('/marketplace');
    // Agents, models and talent are FAMILIES of the storefront, not destinations.
    expect(hrefs).not.toContain('/agents');
    expect(hrefs).not.toContain('/models');
    expect(hrefs).not.toContain('/talent');
  });

  it('leads the signed-out bottom bar with the canvas offer, not a dashboard', () => {
    expect(bottomNavFor(true, false).map((i) => i.href)[0]).toBe('/create');
  });
});

describe('marketplace families — one derivation for label, CTA and flow', () => {
  it('exposes exactly four families', () => {
    expect(FAMILY_IDS).toEqual(['talent', 'company', 'agent', 'asset']);
  });

  it('derives a distinct publish CTA per family', () => {
    const ctas = FAMILY_IDS.map((id) => FAMILIES[id].publishKey);
    expect(new Set(ctas).size).toBe(FAMILY_IDS.length);
  });

  it('runs the CLAIM flow for companies, not a listing form', () => {
    // A company you do not own is not yours to list, so the CTA's flow differs
    // from every other family's — which is why `flow` is a field, not a guess.
    expect(FAMILIES.company.flow).toBe('claim');
    expect(FAMILIES.talent.flow).toBe('listing');
  });

  it('keeps every legacy ?category= link working', () => {
    expect(resolveFamily(null, null, 'gigs')).toEqual({ family: 'talent', kind: 'gig' });
    expect(resolveFamily(null, null, 'models')).toEqual({ family: 'asset', kind: 'model' });
    expect(resolveFamily(null, null, 'workforce').family).toBe('agent');
  });

  it('falls back to the family default when a kind does not belong to it', () => {
    expect(resolveFamily('company', 'model', null)).toEqual({ family: 'company', kind: 'business' });
  });

  it('opens the marketplace on Agents and Builtin by default', () => {
    expect(resolveFamily(null, null, null)).toEqual({ family: 'agent', kind: 'builtin' });
  });

  it('gives each family its own hue so four filters are four colours', () => {
    const hues = FAMILY_IDS.map((id) => FAMILIES[id].hueVar);
    expect(new Set(hues).size).toBe(FAMILY_IDS.length);
  });
});
