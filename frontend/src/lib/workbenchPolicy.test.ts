import { describe, expect, it } from 'vitest';
import { classifyRoute, isStageRoute, panelOpen, panelWidth, rendersOperatorShell } from './workbenchPolicy';

describe('classifyRoute', () => {
  it('puts the canvas surfaces on the stage', () => {
    expect(classifyRoute('/create/c_8fa2')).toBe('stage');
    expect(classifyRoute('/brainstorm')).toBe('stage');
    expect(classifyRoute('/workflows/builder')).toBe('stage');
  });

  it('treats the canvas LIBRARY as a page, not a board', () => {
    // `/create` alone lists your work — docking it beside the board would show
    // you a list of boards next to the board it came from.
    expect(classifyRoute('/create')).toBe('workbench');
    expect(isStageRoute('/create')).toBe(false);
  });

  it('docks ordinary operational pages', () => {
    expect(classifyRoute('/settings')).toBe('workbench');
    expect(classifyRoute('/insights/finance')).toBe('workbench');
    expect(classifyRoute('/tasks')).toBe('workbench');
  });

  it('keeps full-surface project editors alone', () => {
    expect(classifyRoute('/projects/7')).toBe('standalone');
  });

  it('docks the Sales Hub but not its launchers', () => {
    // The hub is a read-out — a link to copy, a lead to check, a payout to
    // chase — so it opens OVER the board an associate is selling from. Its
    // sub-routes only provision and redirect, and a redirect cannot be a panel.
    expect(classifyRoute('/sales')).toBe('workbench');
    expect(panelWidth('/sales')).toBe('wide');
    expect(classifyRoute('/sales/canvas')).toBe('standalone');
    expect(classifyRoute('/sales/referral-claim')).toBe('standalone');
  });

  it('never claims a route outside the operator shell', () => {
    expect(classifyRoute('/pricing')).toBe('standalone');
    expect(classifyRoute('/blog/post')).toBe('standalone');
    expect(classifyRoute('/login')).toBe('standalone');
    expect(classifyRoute('/embed/board')).toBe('standalone');
    expect(classifyRoute('/freelancer/profile')).toBe('standalone');
  });
});

describe('panelOpen', () => {
  // The ROUTE decides, and only the route. It used to take "is there a board?"
  // as a second argument, which made one destination render as a drawer for
  // people mid-canvas and a full-bleed page for everyone else — the same URL,
  // two layouts, chosen by state the person could not see. `LastBoardBridge`
  // guarantees the stage underneath instead.
  it('opens on a workbench destination whether or not a board is up yet', () => {
    expect(panelOpen('/settings')).toBe(true);
    expect(panelOpen('/incidents')).toBe(true);
  });

  it('stays closed on the stage itself and on standalone routes', () => {
    expect(panelOpen('/create/c_8fa2')).toBe(false);
    expect(panelOpen('/projects/7')).toBe(false);
    expect(panelOpen('/blog/some-post')).toBe(false);
  });
});

describe('rendersOperatorShell', () => {
  // The nine destinations the operator named, plus the one that names the rule.
  const WORKBENCH = [
    '/insights', '/seat/governance', '/seat/investor', '/seat/hiring', '/seat/people',
    '/seat/revenue', '/seat/finance', '/growth', '/incidents', '/embedded',
  ];

  it('keeps a guest their board when they consult a destination', () => {
    for (const route of WORKBENCH) {
      expect(rendersOperatorShell(route, false, true)).toBe(true);
    }
  });

  it('gives a guest with NO board the operator shell on a previewable app route', () => {
    // This used to be `false` for every row: with no board there was nothing to
    // keep, so an app route fell back to its acquisition teaser in
    // `MarketingShell`. A guest no longer has to be holding a board to earn the
    // product — the app routes render for everyone (`isGuestPreviewRoute`).
    for (const route of WORKBENCH.filter((r) => r !== '/embedded')) {
      expect(rendersOperatorShell(route, false, false)).toBe(true);
    }
    // `/embedded` is a PUBLIC reference surface, not an app route, so with no
    // board to keep it is still the marketing shell — the half of §11.4.5 that
    // keeps the public surface indexable.
    expect(rendersOperatorShell('/embedded', false, false)).toBe(false);
  });

  it('keeps a guest their board when they open a reference page', () => {
    // The public half of §11.4.5 has the same hazard as the app half: a
    // diagnostic or the embed catalog is exactly what someone checks MID-BUILD.
    expect(rendersOperatorShell('/tools/ai-cost-estimator', false, true)).toBe(true);
    expect(rendersOperatorShell('/embedded', false, true)).toBe(true);
  });

  it('never hands the operator shell to a marketing or framed route', () => {
    // A long article wants the whole screen, board or no board — and the
    // storefront, pricing and the auth screens are not panels at any rung.
    // `/projects/7` is deliberately NOT here any more: it is an app route, and a
    // guest gets the operator shell on every app route that is not operator
    // tooling. What this case still guards is that PUBLIC and FRAMED routes
    // never borrow it.
    for (const route of ['/pricing', '/blog/post', '/login', '/embed/board', '/marketplace']) {
      expect(rendersOperatorShell(route, false, true)).toBe(false);
    }
  });

  it('changes nothing for a signed-in person', () => {
    for (const route of [...WORKBENCH, '/settings', '/create/c_8fa2']) {
      expect(rendersOperatorShell(route, true, false)).toBe(true);
    }
  });
});

describe('panelWidth', () => {
  it('gives your own account the sheet', () => {
    expect(panelWidth('/settings')).toBe('sheet');
    expect(panelWidth('/settings/integrations')).toBe('sheet');
    expect(panelWidth('/security')).toBe('sheet');
  });

  it('gives a dashboard the room it needs', () => {
    expect(panelWidth('/insights/delivery')).toBe('full');
    expect(panelWidth('/admin')).toBe('full');
  });

  it('defaults to index-plus-detail', () => {
    expect(panelWidth('/workforce')).toBe('wide');
    expect(panelWidth('/projects')).toBe('wide');
  });

  it('never returns a fourth width', () => {
    for (const route of ['/settings', '/insights', '/workforce', '/quality', '/knowledge']) {
      expect(['sheet', 'wide', 'full']).toContain(panelWidth(route));
    }
  });
});
