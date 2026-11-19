import { describe, expect, it } from 'vitest';
import { byoOrderPath, parseByoOrder, placeAccount, type ByoOrderEntry, type ByoOrderOutcome } from './byoOrder.js';

const entry = (ref: string, provider: string | null, healthy = true, callableByGateway = true): ByoOrderEntry =>
  ({ ref, vendor: ref.split('/')[1] ?? '', provider, healthy, callableByGateway });
const KIMI = { provider: 'kimi', runtime: 'kimi-code' as const, listed: ['kimi-for-coding', 'k3'] };
const kimiHeads = (freeFirst: boolean): ByoOrderOutcome => ({
  kind: 'order',
  freeFirst,
  entries: [entry('direct/kimi-code/k3', 'kimi'), entry('direct/anthropic/claude-sonnet', 'anthropic')],
});

describe('byoOrderPath', () => {
  it('a call with no role sends none — the gateway orders a role-less call by the tenant precedence, not as code', () => {
    expect(byoOrderPath({ agentic: false })).toBe('/llm/byo-order?agentic=0');
    expect(byoOrderPath({ role: '', agentic: true })).toBe('/llm/byo-order?agentic=1');
  });

  it('a role, project and arc stage are sent as given', () => {
    expect(byoOrderPath({ role: 'review', projectId: 7, arcStage: 'build', agentic: true }))
      .toBe('/llm/byo-order?role=review&projectId=7&arcStage=build&agentic=1');
  });
});

describe('placeAccount', () => {
  it('heading the order with the accounts funded first: LEADS on the model it heads with', () => {
    expect(placeAccount(kimiHeads(false), KIMI)).toEqual({ model: 'k3', placement: 'lead' });
  });

  it('heading the order with the free tier funded first: TRAILS (the gateway tries the free tier before any account), still on that model', () => {
    expect(placeAccount(kimiHeads(true), KIMI)).toEqual({ model: 'k3', placement: 'trail' });
  });

  it('another account heading the order: trails on its own best-listed entry', () => {
    const order: ByoOrderOutcome = {
      kind: 'order',
      freeFirst: false,
      entries: [entry('direct/anthropic/claude-sonnet', 'anthropic'), entry('direct/kimi-code/k3', 'kimi')],
    };
    expect(placeAccount(order, KIMI)).toEqual({ model: 'k3', placement: 'trail' });
  });

  it('an unreadable order: leads on the credential’s first model (no placement)', () => {
    expect(placeAccount({ kind: 'unreadable', detail: 'offline' }, KIMI)).toEqual({ model: 'kimi-for-coding' });
  });

  it('regression: a STALE server alert on its own account (healthy false, gateway cannot call it) — the account still LEADS on k3', () => {
    // The server never observes Kimi Code without an agent host, so the alert never clears;
    // the account is judged by its own resolved credential.
    const order: ByoOrderOutcome = {
      kind: 'order',
      freeFirst: false,
      entries: [entry('direct/kimi-code/k3', 'kimi', false, false), entry('direct/anthropic/claude-sonnet', 'anthropic')],
    };
    expect(placeAccount(order, KIMI)).toEqual({ model: 'k3', placement: 'lead' });
  });

  it('a healthy account ranked ahead still makes it trail (unchanged)', () => {
    const order: ByoOrderOutcome = {
      kind: 'order',
      freeFirst: false,
      entries: [entry('direct/anthropic/claude-sonnet', 'anthropic'), entry('direct/kimi-code/k3', 'kimi', true, false)],
    };
    expect(placeAccount(order, KIMI)).toEqual({ model: 'k3', placement: 'trail' });
  });

  it('another host-called provider the gateway cannot call is skipped when finding the head', () => {
    const order: ByoOrderOutcome = {
      kind: 'order',
      freeFirst: false,
      entries: [entry('direct/kimi-code/k3', 'kimi', true, false), entry('direct/xai/grok-4', 'xai')],
    };
    // For an xAI account this host called itself, the Kimi entry ahead leads nothing.
    const XAI = { provider: 'xai', runtime: 'kimi-code' as const, listed: ['grok-4'] };
    expect(placeAccount(order, XAI)).toEqual({ model: 'grok-4', placement: 'lead' });
    // …whereas a gateway-callable healthy entry ahead still heads it.
    const gatewayAhead: ByoOrderOutcome = { ...order, entries: [entry('direct/kimi-code/k3', 'kimi'), entry('direct/xai/grok-4', 'xai')] };
    expect(placeAccount(gatewayAhead, XAI)).toEqual({ model: 'grok-4', placement: 'trail' });
  });

  it('an absent callableByGateway (an older server) reads as callable', () => {
    const parsed = parseByoOrder({ models: [{ ref: 'direct/kimi-code/k3', vendor: 'kimi-code', provider: 'kimi', healthy: true }] });
    expect(parsed?.entries[0]?.callableByGateway).toBe(true);
    const off = parseByoOrder({ models: [{ ref: 'direct/kimi-code/k3', provider: 'kimi', callableByGateway: false }] });
    expect(off?.entries[0]?.callableByGateway).toBe(false);
  });
});
