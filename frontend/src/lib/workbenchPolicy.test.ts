import { describe, expect, it } from 'vitest';
import { classifyRoute, dockOpen, isStageRoute } from './workbenchPolicy';

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

  it('leaves the other full-surface editors alone', () => {
    expect(classifyRoute('/ide/42')).toBe('standalone');
    expect(classifyRoute('/projects/7')).toBe('standalone');
    // The IDE launcher is an ordinary page and still docks.
    expect(classifyRoute('/ide/dashboard')).toBe('workbench');
  });

  it('never claims a route outside the operator shell', () => {
    expect(classifyRoute('/pricing')).toBe('standalone');
    expect(classifyRoute('/blog/post')).toBe('standalone');
    expect(classifyRoute('/login')).toBe('standalone');
    expect(classifyRoute('/embed/board')).toBe('standalone');
    expect(classifyRoute('/freelancer/profile')).toBe('standalone');
  });
});

describe('dockOpen', () => {
  it('opens only when there is a board worth keeping', () => {
    expect(dockOpen('/settings', true)).toBe(true);
    expect(dockOpen('/settings', false)).toBe(false);
  });

  it('stays closed on the stage itself and on standalone routes', () => {
    expect(dockOpen('/create/c_8fa2', true)).toBe(false);
    expect(dockOpen('/ide/42', true)).toBe(false);
  });
});
