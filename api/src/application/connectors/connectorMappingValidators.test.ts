/**
 * The rules that keep a manifest's data mappings from building an address, reading a
 * credential or running a pattern its author did not mean — for built-in and tenant
 * manifests alike.
 */
import { describe, expect, it } from 'vitest';
import { parseConnectorManifest, RESERVED_APPLICANT_SOURCES, type ConnectorManifest } from './connectorManifest';
import {
  MAX_PATTERN_INPUT,
  matchesPattern,
  templateConnectionFields,
  validatePattern,
  validateSelectorList,
  validateUrlTemplate,
} from './connectorMappingValidators';
import { HIRING_CONNECTORS } from './defaults/hiring';
import { sourceAliasConflicts } from '../hiring/applicantSource';

const PUBLIC = new Set(['subdomain', 'board_token']);
const check = (template: unknown, fields: ReadonlySet<string> = PUBLIC) => {
  const errors: string[] = [];
  const value = validateUrlTemplate(template, 'x.urlTemplate', fields, errors);
  return { value, errors };
};

describe('validateUrlTemplate', () => {
  it('accepts a literal https host with the known placeholders', () => {
    expect(check('https://apply.workable.com/{connection.subdomain}/j/{externalId}/').errors).toEqual([]);
    expect(check('https://boards.greenhouse.io/{connection.board_token}/jobs/{postId}').errors).toEqual([]);
  });

  it('refuses a placeholder in the scheme or host — a value must never choose the host', () => {
    for (const bad of [
      'https://{connection.subdomain}.workable.com/j/{externalId}',
      'https://apply.{connection.subdomain}.com/{externalId}',
      'https://{externalId}',
      'https://{connection.subdomain}/x',
    ]) {
      const { value, errors } = check(bad);
      expect(value, bad).toBeNull();
      expect(errors[0], bad).toMatch(/scheme and host must be literal/);
    }
  });

  it('allows a placeholder after the first slash, and in the query', () => {
    expect(check('https://x.test/{externalId}?board={connection.board_token}').errors).toEqual([]);
  });

  it('refuses {connection.<field>} unless the field is declared secret:false', () => {
    const { value, errors } = check('https://x.test/{connection.api_key}/{externalId}');
    expect(value).toBeNull();
    expect(errors[0]).toMatch(/\{connection\.api_key\} must name an auth field declared with secret: false/);
  });

  it('refuses http, an unknown placeholder, and an oversize template', () => {
    expect(check('http://x.test/{externalId}').value).toBeNull();
    expect(check('https://x.test/{secret}').value).toBeNull();
    expect(check(`https://x.test/${'a'.repeat(600)}`).value).toBeNull();
    expect(check(42).value).toBeNull();
  });

  it('names {postId} in every template error, consistently', () => {
    for (const bad of ['http://x.test/', 'https://x.test/{nope}']) {
      expect(check(bad).errors[0]).toMatch(/\{externalId\}, \{postId\} and \{connection\.<field>\}/);
    }
  });
});

describe('templateConnectionFields — the one extractor', () => {
  it('lists only the connection fields', () => {
    expect(templateConnectionFields('https://x.test/{connection.a}/{externalId}/{connection.b}/{postId}')).toEqual(['a', 'b']);
    expect(templateConnectionFields(undefined)).toEqual([]);
  });
});

describe('the placeholder rule applies to TENANT manifests through the manifest gate', () => {
  const tenant = (auth: Record<string, unknown>, urlTemplate: string): unknown => ({
    key: 'acme-board', name: 'Acme', category: 'hiring', icon: '🏢', baseUrl: 'https://api.acme.test',
    auth: { kind: 'api_key', in: 'header', name: 'Authorization', fields: [auth] },
    actions: [{
      key: 'create_posting', label: 'Publish', description: 'Publish', method: 'POST', path: '/jobs', mutates: true,
      params: {}, response: { externalId: ['id'], urlTemplate },
    }],
  });

  it('rejects a template naming a secret field (secret defaults to TRUE when undeclared)', () => {
    expect(() => parseConnectorManifest(tenant({ key: 'apiKey', label: 'Key' }, 'https://x.test/{connection.apiKey}/{externalId}'))).toThrow(/secret: false/);
  });

  it('accepts one that names a field declared secret:false', () => {
    const manifest = parseConnectorManifest(tenant({ key: 'slug', label: 'Slug', secret: false }, 'https://x.test/{connection.slug}/{externalId}'));
    expect(manifest.actions[0]!.response?.urlTemplate).toBe('https://x.test/{connection.slug}/{externalId}');
  });

  it('every built-in template passes the same gate', () => {
    for (const manifest of HIRING_CONNECTORS) expect(() => parseConnectorManifest(manifest)).not.toThrow();
  });
});

describe('patterns are anchored, bounded and free of nested quantifiers', () => {
  it('validatePattern rejects an over-long, uncompilable or nested-quantifier source', () => {
    const errors: string[] = [];
    expect(validatePattern('\\d+', 'p', errors)).toBe('\\d+');
    expect(validatePattern('x'.repeat(101), 'p', errors)).toBeNull();
    expect(validatePattern('(', 'p', errors)).toBeNull();
    expect(validatePattern('(a+)+', 'p', errors)).toBeNull();
    expect(validatePattern('(\\d*)*', 'p', errors)).toBeNull();
    expect(errors).toHaveLength(4);
  });

  it('matchesPattern is a FULL match on a bounded input', () => {
    expect(matchesPattern('\\d+', '123')).not.toBeNull();
    expect(matchesPattern('\\d+', '123abc')).toBeNull(); // not a substring match
    expect(matchesPattern('urn:li:jobPosting:(\\d+)', 'urn:li:jobPosting:55')?.[1]).toBe('55');
    expect(matchesPattern('.*', 'x'.repeat(MAX_PATTERN_INPUT + 1))).toBeNull();
  });
});

describe('selector lists', () => {
  it('allows header selectors only where asked', () => {
    const errors: string[] = [];
    expect(validateSelectorList('header:x-restli-id', 's', errors)).toBeNull();
    expect(validateSelectorList(['header:x-restli-id', 'id'], 's', errors, { allowHeader: true })).toEqual(['header:x-restli-id', 'id']);
    expect(validateSelectorList([], 's', errors)).toBeNull();
    expect(validateSelectorList(['a.b.0.c'], 's', errors)).toEqual(['a.b.0.c']);
  });
});

describe('sourceAliases', () => {
  const board = (sourceAliases: string[], key = 'acme-board'): unknown => ({
    key, name: 'Acme', category: 'hiring', icon: '🏢', baseUrl: 'https://api.acme.test', auth: { kind: 'none' },
    actions: [{ key: 'list', label: 'List', description: 'List jobs', method: 'GET', path: '/jobs', mutates: false, params: {} }],
    sourceAliases,
  });

  it('rejects a reserved source vocabulary word, however it is spelled', () => {
    expect(RESERVED_APPLICANT_SOURCES).toEqual(expect.arrayContaining(['direct', 'referral', 'careers-site']));
    for (const reserved of ['Direct', ' REFERRAL ', 'careers site', 'Careers_Site']) {
      expect(() => parseConnectorManifest(board([reserved])), reserved).toThrow(/reserved source/);
    }
    expect(parseConnectorManifest(board(['acme', 'acme.com'])).sourceAliases).toEqual(['acme', 'acme.com']);
  });

  it('rejects a collision with another board’s key or alias', () => {
    const manifest = parseConnectorManifest(board(['LinkedIn.com', 'acme'])) as ConnectorManifest;
    const conflicts = sourceAliasConflicts(manifest);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatch(/"LinkedIn\.com" is already used by the "linkedin-jobs" job board/);
    expect(sourceAliasConflicts(parseConnectorManifest(board(['indeed-jobs'])) as ConnectorManifest)[0]).toMatch(/indeed-jobs/);
    expect(sourceAliasConflicts(parseConnectorManifest(board(['acme'])) as ConnectorManifest)).toEqual([]);
  });

  it('a built-in board does not conflict with itself', () => {
    for (const manifest of HIRING_CONNECTORS) expect(sourceAliasConflicts(manifest), manifest.key).toEqual([]);
  });
});
