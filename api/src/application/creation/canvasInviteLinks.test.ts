import { describe, expect, it } from 'vitest';
import {
  asCanvasLinkRole,
  canvasJoinPath,
  CANVAS_LINK_ROLES,
  CANVAS_LINK_TOKEN_RE,
  linkRoleForShareScope,
  shareScopeForLinkRole,
} from './canvasInviteLinks';
import { cleanGuestName, GUEST_ACCOUNT_TYPE, isGuestAccount } from './canvasGuestAccount';

describe('what a canvas invite link may carry', () => {
  it('refuses the two roles that must never travel in a URL', () => {
    // `runner` spends the workspace's tokens; `owner` can give the board away. A link is
    // forwardable by whoever holds it, so neither is offerable — and the refusal has to be
    // a null rather than a silent downgrade, or a caller asking for `owner` would quietly
    // mint something else and believe it succeeded.
    expect(asCanvasLinkRole('runner')).toBeNull();
    expect(asCanvasLinkRole('owner')).toBeNull();
    expect(asCanvasLinkRole('nonsense')).toBeNull();
    expect(asCanvasLinkRole(undefined)).toBeNull();
  });

  it('round-trips every role it does allow through the stored share scope', () => {
    for (const role of CANVAS_LINK_ROLES) {
      expect(linkRoleForShareScope(shareScopeForLinkRole(role))).toBe(role);
    }
  });

  it('reads an unrecognised stored scope as the LEAST access, never the most', () => {
    // A scope this build does not understand must not widen into an editor.
    expect(linkRoleForShareScope('admin')).toBe('viewer');
    expect(linkRoleForShareScope('')).toBe('viewer');
  });
});

describe('the link itself', () => {
  it('points at the join route, and only the token varies', () => {
    expect(canvasJoinPath('a'.repeat(64))).toBe(`/create/join/${'a'.repeat(64)}`);
  });

  it('accepts the shape createShareLink mints and nothing else', () => {
    expect(CANVAS_LINK_TOKEN_RE.test('a'.repeat(64))).toBe(true);
    expect(CANVAS_LINK_TOKEN_RE.test('A'.repeat(64))).toBe(true);
    expect(CANVAS_LINK_TOKEN_RE.test('a'.repeat(63))).toBe(false);
    expect(CANVAS_LINK_TOKEN_RE.test(`${'a'.repeat(63)}z`)).toBe(false);
    expect(CANVAS_LINK_TOKEN_RE.test('../../etc/passwd')).toBe(false);
  });
});

describe('the guest identity a claim mints', () => {
  it('never produces an empty or unbounded display name', () => {
    expect(cleanGuestName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(cleanGuestName('')).toBe('Guest');
    expect(cleanGuestName(null)).toBe('Guest');
    expect(cleanGuestName(42)).toBe('Guest');
    expect(cleanGuestName('x'.repeat(200))).toHaveLength(40);
  });

  it('is recognisable by exactly one field', () => {
    expect(isGuestAccount(GUEST_ACCOUNT_TYPE)).toBe(true);
    expect(isGuestAccount('standard')).toBe(false);
    expect(isGuestAccount(null)).toBe(false);
    expect(isGuestAccount(undefined)).toBe(false);
  });
});
