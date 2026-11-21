/** GAP-W12: the sandbox workspace must live outside any git checkout that could commit it. */
import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { assertWorkspaceOutsideCheckout, WORKSPACE_INSIDE_CHECKOUT, workspaceInsideCheckout } from '../../../container/sandboxCore.mjs';

const root = resolve('/srv/checkout');

describe('workspaceInsideCheckout', () => {
  it('is true for the checkout itself and any path below it', () => {
    expect(workspaceInsideCheckout(root, root)).toBe(true);
    expect(workspaceInsideCheckout(join(root, 'ws', 'run-1'), root)).toBe(true);
  });
  it('is false for a sibling, a prefix-named sibling and missing input', () => {
    expect(workspaceInsideCheckout(resolve('/tmp/bf-ws-1'), root)).toBe(false);
    expect(workspaceInsideCheckout(resolve('/srv/checkout-2/ws'), root)).toBe(false);
    expect(workspaceInsideCheckout('', root)).toBe(false);
  });
});

describe('assertWorkspaceOutsideCheckout', () => {
  it('refuses a nested workspace with the typed code', () => {
    const r = assertWorkspaceOutsideCheckout(join(root, 'ws'), root);
    expect(r).toMatchObject({ ok: false, code: WORKSPACE_INSIDE_CHECKOUT });
  });
  it('accepts a workspace outside', () => {
    expect(assertWorkspaceOutsideCheckout(resolve('/tmp/bf-ws-1'), root)).toEqual({ ok: true });
  });
});
