/**
 * The review gate is the only thing standing between a stranger's JSON and a
 * manifest our runtime executes against a customer's credentials, so its refusals
 * are tested as behaviour rather than as coverage.
 */
import { describe, expect, it } from 'vitest';
import { reviewVersion } from './packageReview';
import {
  installGrants,
  meetsVerification,
  publishes,
  scopeUpgrade,
} from './extensionContract';
import { tenantRoleAtLeast } from '../tenant/tenantRoles';
import { deserializeScopes, hasScope, requireScope, serializeScopes, widenedScopes } from '../shared/scopeList';

/** A minimal manifest that passes the connector parser. */
const goodManifest = (over: Record<string, unknown> = {}) => ({
  key: 'acme-payroll',
  name: 'Acme Payroll',
  description: 'Run payroll',
  category: 'finance',
  baseUrl: 'https://api.acme-payroll.example',
  auth: { kind: 'api_key', fields: [{ key: 'token', label: 'API token', secret: true, required: true }], in: 'header', name: 'Authorization' },
  actions: [
    {
      key: 'list_employees',
      label: 'List employees',
      description: 'List every employee on the payroll',
      method: 'GET',
      path: '/v1/employees',
      mutates: false,
      params: {},
    },
  ],
  ...over,
});

const base = {
  kind: 'connector' as const,
  requestedScopes: ['tools:call'],
  verificationState: 'domain_verified',
  paid: false,
};

const findingFor = (findings: Array<{ check: string; severity: string }>, check: string) =>
  findings.find((f) => f.check === check);

describe('reviewVersion — connector', () => {
  it('approves a well-formed manifest', () => {
    const out = reviewVersion({ ...base, spec: goodManifest() });
    expect(out.approved).toBe(true);
    expect(findingFor(out.findings, 'manifest_parse')?.severity).toBe('pass');
    expect(out.scopes).toEqual(['tools:call']);
  });

  it('refuses a key that shadows a built-in connector', () => {
    // The blast radius is the whole platform, not one workspace: a published
    // `slack` would shadow the built-in for everyone who installed it.
    const out = reviewVersion({ ...base, spec: goodManifest({ key: 'slack' }) });
    expect(out.approved).toBe(false);
    expect(findingFor(out.findings, 'reserved_key')?.severity).toBe('fail');
  });

  it('refuses a manifest with a credential baked into it', () => {
    const out = reviewVersion({
      ...base,
      spec: goodManifest({ description: 'token sk_\x6cive_abcdefghijklmnop0123456789' }),
    });
    expect(out.approved).toBe(false);
    expect(findingFor(out.findings, 'secret_scan')?.severity).toBe('fail');
  });

  it('refuses a non-https base URL', () => {
    const out = reviewVersion({ ...base, spec: goodManifest({ baseUrl: 'http://169.254.169.254' }) });
    expect(out.approved).toBe(false);
  });

  it('warns, but does not refuse, when an action has no description', () => {
    const spec = goodManifest();
    (spec.actions as Array<Record<string, unknown>>)[0]!.description = '';
    const out = reviewVersion({ ...base, spec });
    expect(out.approved).toBe(true);
    expect(findingFor(out.findings, 'action_descriptions')?.severity).toBe('warn');
  });
});

describe('reviewVersion — mcp_server', () => {
  const mcp = { kind: 'mcp_server' as const, requestedScopes: ['tools:call'], verificationState: 'unverified', paid: false };

  it('approves a public https server with declared tools', () => {
    const out = reviewVersion({ ...mcp, spec: { serverUrl: 'https://mcp.acme.example', tools: [{ name: 'lookup' }] } });
    expect(out.approved).toBe(true);
  });

  it('refuses a server with no declared tools — an undeclared tool cannot be reviewed', () => {
    const out = reviewVersion({ ...mcp, spec: { serverUrl: 'https://mcp.acme.example', tools: [] } });
    expect(out.approved).toBe(false);
    expect(findingFor(out.findings, 'tools_declared')?.severity).toBe('fail');
  });

  it('refuses a publisher-supplied secret — the tenant supplies it at install', () => {
    const out = reviewVersion({
      ...mcp,
      spec: { serverUrl: 'https://mcp.acme.example', tools: [{ name: 'x' }], secret: 'hunter2' },
    });
    expect(out.approved).toBe(false);
    expect(findingFor(out.findings, 'no_inline_secret')?.severity).toBe('fail');
  });

  it('refuses a private-network server URL', () => {
    const out = reviewVersion({ ...mcp, spec: { serverUrl: 'https://localhost/mcp', tools: [{ name: 'x' }] } });
    expect(out.approved).toBe(false);
  });
});

describe('reviewVersion — gates that are not about the spec', () => {
  it('fails closed on a kind that is declared but not open for submission', () => {
    // `canvas_kind` is in EXTENSION_KINDS and NOT in SUBMITTABLE_KINDS. The gap
    // between the two lists is refused by construction, not by remembering to.
    const out = reviewVersion({ ...base, kind: 'canvas_kind' as never, spec: goodManifest() });
    expect(out.approved).toBe(false);
    expect(findingFor(out.findings, 'kind_open')?.severity).toBe('fail');
  });

  it('refuses an unknown scope rather than storing a grant nothing enforces', () => {
    const out = reviewVersion({ ...base, spec: goodManifest(), requestedScopes: ['tools:call', 'read:everything'] });
    expect(out.approved).toBe(false);
    expect(out.scopes).toEqual(['tools:call']);
  });

  it('refuses a package that asks for nothing', () => {
    const out = reviewVersion({ ...base, spec: goodManifest(), requestedScopes: [] });
    expect(out.approved).toBe(false);
    expect(findingFor(out.findings, 'scope_declared')?.severity).toBe('fail');
  });

  it('refuses a paid listing from a publisher who is not identity-verified', () => {
    const out = reviewVersion({ ...base, spec: goodManifest(), paid: true, verificationState: 'domain_verified' });
    expect(out.approved).toBe(false);
    expect(findingFor(out.findings, 'paid_requires_identity')?.severity).toBe('fail');
  });

  it('allows a paid listing once the publisher is identity-verified', () => {
    const out = reviewVersion({ ...base, spec: goodManifest(), paid: true, verificationState: 'identity_verified' });
    expect(out.approved).toBe(true);
  });

  it('warns when a version widens scopes on its predecessor', () => {
    const out = reviewVersion({
      ...base,
      spec: goodManifest(),
      requestedScopes: ['tools:call', 'write:tickets'],
      previousScopes: ['tools:call'],
    });
    expect(findingFor(out.findings, 'scope_widened')?.severity).toBe('warn');
    expect(findingFor(out.findings, 'sensitive_scopes')?.severity).toBe('warn');
    expect(out.approved).toBe(true);
  });
});

describe('the grant is the security boundary', () => {
  it('an empty install grant permits NOTHING — unlike a legacy API key', () => {
    // The two rules differ because the two populations do: API keys minted before
    // scopes existed must keep working; an install has no such history.
    expect(installGrants([], 'tools:call')).toBe(false);
    expect(installGrants(null, 'tools:call')).toBe(false);
    expect(hasScope([], 'ingest:feedback')).toBe(true);
  });

  it('grants exactly what was approved', () => {
    expect(installGrants(['tools:call'], 'tools:call')).toBe(true);
    expect(installGrants(['tools:call'], 'write:canvas')).toBe(false);
  });

  it('auto-updates only when nothing widened, and names what did', () => {
    expect(scopeUpgrade(['tools:call'], ['tools:call'])).toEqual({ auto: true, added: [] });
    expect(scopeUpgrade(['tools:call'], ['tools:call', 'write:canvas'])).toEqual({
      auto: false,
      added: ['write:canvas'],
    });
    // A version that NARROWS is still an auto-update: nothing new is being asked for.
    expect(scopeUpgrade(['tools:call', 'write:canvas'], ['tools:call'])).toEqual({ auto: true, added: [] });
  });
});

describe('shared scope list', () => {
  it('drops scopes outside the vocabulary on write', () => {
    expect(serializeScopes(['a', 'b'], ['a'])).toBe('["a"]');
    expect(serializeScopes(['zzz'], ['a'])).toBeNull();
    expect(serializeScopes([], ['a'])).toBeNull();
  });

  it('reads malformed storage as "no list" rather than throwing', () => {
    expect(deserializeScopes('not json')).toBeNull();
    expect(deserializeScopes(null)).toBeNull();
    expect(deserializeScopes('["a",7]')).toEqual(['a']);
  });

  it('separates the lenient and strict rules', () => {
    expect(hasScope(null, 'x')).toBe(true);
    expect(requireScope(null, 'x')).toBe(false);
  });

  it('reports only what is newly asked for', () => {
    expect(widenedScopes(['a'], ['a', 'b'])).toEqual(['b']);
    expect(widenedScopes(null, ['a'])).toEqual(['a']);
    expect(widenedScopes(['a', 'b'], ['a'])).toEqual([]);
  });
});

describe('ordered vocabularies', () => {
  it('compares verification tiers by order, not by enumeration', () => {
    expect(meetsVerification('identity_verified', 'domain_verified')).toBe(true);
    expect(meetsVerification('domain_verified', 'identity_verified')).toBe(false);
    expect(meetsVerification('unverified', 'unverified')).toBe(true);
    expect(meetsVerification('nonsense', 'unverified')).toBe(false);
  });

  it('reads "does this workspace publish?" off the same scale as the tier', () => {
    // 'none' is a state on the SAME ordered list, not a second boolean column.
    // That is what makes the impossible combination — not a publisher, yet
    // identity-verified — unrepresentable rather than merely unlikely.
    expect(publishes('none')).toBe(false);
    expect(publishes('unverified')).toBe(true);
    expect(publishes('identity_verified')).toBe(true);
    expect(publishes('nonsense')).toBe(false);
    expect(meetsVerification('none', 'unverified')).toBe(false);
  });

  it('gates publisher actions on the TENANT role ladder, not a second one', () => {
    // Migration 0471 deleted this context's own owner/admin/publisher ladder.
    // A publisher's staff are workspace members, so "may they ship a version?"
    // is answered by the ladder that already governs every other action.
    expect(tenantRoleAtLeast('owner', 'developer')).toBe(true);
    expect(tenantRoleAtLeast('manager', 'developer')).toBe(true);
    expect(tenantRoleAtLeast('developer', 'manager')).toBe(false);
    expect(tenantRoleAtLeast('viewer', 'developer')).toBe(false);
    expect(tenantRoleAtLeast('nonsense', 'viewer')).toBe(false);
    expect(tenantRoleAtLeast(null, 'viewer')).toBe(false);
  });
});
