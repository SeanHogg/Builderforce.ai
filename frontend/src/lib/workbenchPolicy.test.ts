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

  it('never claims a route outside the operator shell', () => {
    expect(classifyRoute('/pricing')).toBe('standalone');
    expect(classifyRoute('/blog/post')).toBe('standalone');
    expect(classifyRoute('/login')).toBe('standalone');
    expect(classifyRoute('/embed/board')).toBe('standalone');
    expect(classifyRoute('/freelancer/profile')).toBe('standalone');
  });
});

describe('panelOpen', () => {
  it('opens only when there is a board worth keeping', () => {
    expect(panelOpen('/settings', true)).toBe(true);
    expect(panelOpen('/settings', false)).toBe(false);
  });

  it('stays closed on the stage itself and on standalone routes', () => {
    expect(panelOpen('/create/c_8fa2', true)).toBe(false);
    expect(panelOpen('/projects/7', true)).toBe(false);
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

  it('still gives a guest with NO board marketing chrome', () => {
    // Nothing to keep, so nothing changes: an app route shows its acquisition
    // teaser and `/embedded` shows its real page — both in `MarketingShell`,
    // which is the half of §11.4.5 that keeps the public surface indexable.
    for (const route of WORKBENCH) {
      expect(rendersOperatorShell(route, false, false)).toBe(false);
    }
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
    for (const route of ['/pricing', '/blog/post', '/login', '/embed/board', '/projects/7', '/marketplace']) {
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
