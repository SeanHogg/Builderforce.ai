/**
 * The `connector` workflow node.
 *
 * These assertions are about the two things that decide whether a workflow can
 * actually drive an integration: that the upstream payload reaches the action's
 * parameters, and that a malformed configuration is REPORTED rather than
 * silently sent as an empty call.
 */
import { describe, it, expect } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  executeConnectorNode,
  parseConnectorInput,
  renderConnectorInput,
  renderConnectorTemplate,
} from './connectorNode';

describe('renderConnectorTemplate', () => {
  it('substitutes the whole upstream payload for {{input}}', () => {
    expect(renderConnectorTemplate('Hello {{input}}', 'world')).toBe('Hello world');
    expect(renderConnectorTemplate('{{ input }}', 'spaced')).toBe('spaced');
  });

  it('reads ONE field out of a JSON payload — the case an SMS reply needs', () => {
    const payload = JSON.stringify({ From: '+14155551234', Body: 'where is my order' });
    expect(renderConnectorTemplate('{{input.From}}', payload)).toBe('+14155551234');
    expect(renderConnectorTemplate('Re: {{input.Body}}', payload)).toBe('Re: where is my order');
  });

  it('walks nested paths and array indexes', () => {
    const payload = JSON.stringify({ data: { object: { customer_email: 'ada@example.com' } }, items: [{ sku: 'A1' }] });
    expect(renderConnectorTemplate('{{input.data.object.customer_email}}', payload)).toBe('ada@example.com');
    expect(renderConnectorTemplate('{{input.items[0].sku}}', payload)).toBe('A1');
  });

  it('renders a missing field as empty rather than the string "undefined"', () => {
    // "undefined" in an SMS body is the classic template bug and it goes out to
    // a real customer, so an absent value must vanish rather than print.
    expect(renderConnectorTemplate('[{{input.nope}}]', '{"a":1}')).toBe('[]');
    expect(renderConnectorTemplate('[{{input.a.b.c}}]', '{"a":1}')).toBe('[]');
  });

  it('falls back to empty for a field path when the payload is not JSON', () => {
    expect(renderConnectorTemplate('{{input.From}}', 'plain text')).toBe('');
    // …but the whole-payload form still works, so a plain-text upstream node is
    // not useless.
    expect(renderConnectorTemplate('{{input}}', 'plain text')).toBe('plain text');
  });

  it('leaves a template-free string untouched', () => {
    expect(renderConnectorTemplate('+14155550000', '{"a":1}')).toBe('+14155550000');
  });
});

describe('renderConnectorInput', () => {
  it('templates every string in the tree and leaves other types alone', () => {
    const rendered = renderConnectorInput(
      { To: '{{input.From}}', Body: 'Thanks!', retries: 3, flags: ['{{input.From}}', true] },
      JSON.stringify({ From: '+15551234567' }),
    );
    expect(rendered).toEqual({
      To: '+15551234567',
      Body: 'Thanks!',
      retries: 3,
      flags: ['+15551234567', true],
    });
  });
});

describe('executeConnectorNode — a pinned connectionId', () => {
  const TENANT = 7;
  const run = (db: ReturnType<typeof fakeDb>, connectionId: string) =>
    executeConnectorNode(
      { db: db as unknown as Db, env: { JWT_SECRET: 's' } as unknown as Env, tenantId: TENANT },
      { connector: 'twilio', action: 'send_sms', connectionId, input: { To: '+1', From: '+2', Body: 'hi' } },
      '',
    );

  /** Every bound value in a Drizzle where-clause. */
  function boundValues(node: unknown, out: unknown[] = [], seen = new Set<unknown>()): unknown[] {
    if (node === null || typeof node !== 'object' || seen.has(node)) return out;
    seen.add(node);
    const n = node as { queryChunks?: unknown[]; value?: unknown; encoder?: unknown };
    if (n.encoder !== undefined && 'value' in n) out.push(n.value);
    for (const chunk of n.queryChunks ?? []) boundValues(chunk, out, seen);
    return out;
  }

  it('rejects a connection that belongs to another tenant — the lookup is tenant-scoped, so no row comes back', async () => {
    const db = fakeDb([[]]); // the tenant predicate excludes the foreign row
    const result = await run(db, 'conn-of-tenant-9');
    expect(result).toEqual({ ok: false, error: 'Connection not found' });
    const values = boundValues(db.calls[0]!.where);
    expect(values).toContain(TENANT);
    expect(values).toContain('conn-of-tenant-9');
  });
});

describe('parseConnectorInput', () => {
  it('accepts an object and a JSON string, and treats blank as no parameters', () => {
    expect(parseConnectorInput({ To: '+1' })).toEqual({ ok: true, input: { To: '+1' } });
    expect(parseConnectorInput('{"To":"+1"}')).toEqual({ ok: true, input: { To: '+1' } });
    expect(parseConnectorInput('')).toEqual({ ok: true, input: {} });
    expect(parseConnectorInput('   ')).toEqual({ ok: true, input: {} });
    expect(parseConnectorInput(undefined)).toEqual({ ok: true, input: {} });
  });

  it('REPORTS malformed JSON instead of quietly sending no parameters', () => {
    // Sending an empty call would make a mistyped brace look like a connector
    // that ignores its inputs — a failure nobody would think to look for here.
    const result = parseConnectorInput('{"To": }');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not valid JSON/i);
  });

  it('rejects a JSON array or scalar — an action takes named parameters', () => {
    expect(parseConnectorInput('[1,2]').ok).toBe(false);
    expect(parseConnectorInput('"hello"').ok).toBe(false);
    expect(parseConnectorInput(42).ok).toBe(false);
  });
});
