/**
 * The search projection decides what CAN be found. A capability name missing from
 * it is a listing nobody searching for what it does will ever see, and that is
 * invisible in every other test — the endpoint returns 200 and an empty list.
 */
import { describe, expect, it } from 'vitest';
import { buildSearchText } from './catalogSearch';

describe('buildSearchText', () => {
  it('carries the CAPABILITY names out of a connector manifest, not just the blurb', () => {
    const text = buildSearchText({
      name: 'Acme Payroll',
      tagline: 'Payroll for small teams',
      description: null,
      categories: ['finance'],
      kind: 'connector',
      spec: {
        actions: [
          { key: 'create_invoice', label: 'Create invoice', description: 'Raise a new invoice for a customer' },
          { key: 'list_employees', label: 'List employees', description: 'Every employee on the payroll' },
        ],
      },
    });
    // Somebody types what the thing DOES.
    expect(text).toContain('create_invoice');
    expect(text).toContain('raise a new invoice');
    expect(text).toContain('finance');
  });

  it('carries an MCP server\'s declared tool names', () => {
    const text = buildSearchText({
      name: 'Acme Docs',
      kind: 'mcp_server',
      spec: { tools: ['search_docs', { name: 'fetch_page' }] },
    });
    expect(text).toContain('search_docs');
    expect(text).toContain('fetch_page');
  });

  it('is lowercased and whitespace-collapsed, so the ILIKE branch matches what a person typed', () => {
    const text = buildSearchText({ name: '  Acme   PAYROLL ', kind: 'connector', spec: null });
    expect(text).toBe('acme payroll');
  });

  it('survives a kind it has no capability reader for, rather than throwing', () => {
    expect(buildSearchText({ name: 'Thing', kind: 'canvas_kind', spec: { anything: true } })).toBe('thing');
  });

  it('caps the projection so one verbose manifest cannot bloat the shared index', () => {
    const text = buildSearchText({
      name: 'x',
      description: 'y'.repeat(20_000),
      kind: 'connector',
      spec: null,
    });
    expect(text.length).toBeLessThanOrEqual(8_000);
  });
});
