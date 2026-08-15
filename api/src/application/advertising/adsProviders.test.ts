import { describe, expect, it } from 'vitest';
import {
  ADS_CONNECTOR_KEYS,
  AD_NETWORKS,
  AD_OBJECTIVES,
  adsProviderForConnector,
  allAdsProviders,
  AdsProviderError,
  fromCents,
  getAdsProvider,
  isAdNetwork,
  isAdObjective,
  isRetryableAdStatus,
  toCents,
  toDay,
  toISO,
  totalInsights,
  type AdCall,
  type AdCallResult,
  type AdAccountIdentity,
} from './adsProviders';

/**
 * A fake connector runtime.
 *
 * The adapters are pure translation — which action to call and what the answer means —
 * so they are asserted directly against recorded provider payloads rather than through
 * a mocked fetch. That is where the real defects live: eight networks report the same
 * four facts in four different units.
 */
function calls(responses: Record<string, Partial<AdCallResult>>): {
  call: AdCall;
  seen: Array<{ action: string; input: Record<string, unknown> }>;
} {
  const seen: Array<{ action: string; input: Record<string, unknown> }> = [];
  const call: AdCall = async (actionKey, input = {}) => {
    seen.push({ action: actionKey, input });
    const hit = responses[actionKey];
    if (!hit) throw new Error(`unexpected action ${actionKey}`);
    return { ok: true, status: 200, data: null, ...hit };
  };
  return { call, seen };
}

const identity = (over: Partial<AdAccountIdentity> = {}): AdAccountIdentity =>
  ({ externalId: 'act_1', name: 'Acme', currency: 'USD', ...over });

describe('registry', () => {
  /** Counted against AD_NETWORKS rather than a literal, so a ninth network does not
   *  fail this test for being right. What is guarded is that every declared network
   *  actually has an adapter — the thing that would otherwise 500 at call time. */
  it('has an adapter for every declared network', () => {
    expect(allAdsProviders()).toHaveLength(AD_NETWORKS.length);
    for (const network of AD_NETWORKS) {
      const provider = getAdsProvider(network);
      expect(provider, `no adapter for ${network}`).toBeTruthy();
      expect(provider!.network).toBe(network);
    }
  });

  it('resolves a provider from its connector key, and exposes every key', () => {
    expect(ADS_CONNECTOR_KEYS).toHaveLength(AD_NETWORKS.length);
    for (const key of ADS_CONNECTOR_KEYS) {
      expect(adsProviderForConnector(key)?.connectorKey).toBe(key);
    }
    expect(adsProviderForConnector('not-an-ad-network')).toBeNull();
  });

  it('rejects an unknown network rather than resolving something', () => {
    expect(isAdNetwork('meta')).toBe(true);
    expect(isAdNetwork('myspace')).toBe(false);
    expect(getAdsProvider('myspace')).toBeNull();
  });

  /** Every objective a provider claims must be in the shared vocabulary — a typo here
   *  would make an objective unreachable from the API while looking supported. */
  it('only claims objectives from the shared vocabulary', () => {
    for (const provider of allAdsProviders()) {
      expect(provider.objectives.length, `${provider.network} claims none`).toBeGreaterThan(0);
      for (const objective of provider.objectives) {
        expect(isAdObjective(objective), `${provider.network} claims ${objective}`).toBe(true);
      }
    }
  });

  /** Between them the eight must cover the whole vocabulary; an objective no network
   *  serves is one the API accepts and can never fulfil. */
  it('covers every objective across the networks', () => {
    const covered = new Set(allAdsProviders().flatMap((provider) => provider.objectives));
    for (const objective of AD_OBJECTIVES) {
      expect(covered.has(objective), `no network serves ${objective}`).toBe(true);
    }
  });
});

describe('money', () => {
  /**
   * The single most consequential function here. Every network bills in a different
   * unit, and reading one with another's scale is a 100x or 10,000x error in a money
   * column — in the direction that still looks plausible on a dashboard.
   */
  it('converts each network unit to integer cents', () => {
    expect(toCents(1_230_000, 1_000_000)).toBe(123);      // Google/X/Reddit/Pinterest micros
    expect(toCents(5000, 100)).toBe(5000);                // Meta budget, currency minor unit
    expect(toCents('49.97', 1)).toBe(4997);               // Meta spend, decimal-string major unit
    expect(toCents(50, 1)).toBe(5000);                    // TikTok major unit
  });

  it('round-trips a budget back to the network unit', () => {
    expect(fromCents(5000, 1_000_000)).toBe(50_000_000);
    expect(fromCents(5000, 1)).toBe(50);
    expect(fromCents(4997, 100)).toBe(4997);
  });

  it('returns null rather than 0 for an absent amount', () => {
    // A campaign with NO daily budget and a campaign with a ZERO budget are different
    // facts; collapsing them would make an uncapped campaign look capped.
    expect(toCents(null, 1_000_000)).toBeNull();
    expect(toCents('', 1)).toBeNull();
    expect(toCents('not a number', 1)).toBeNull();
    expect(fromCents(null, 100)).toBeNull();
  });

  it('always produces an integer, because the column is one', () => {
    expect(Number.isInteger(toCents('0.015', 1))).toBe(true);
    expect(Number.isInteger(toCents(1, 3))).toBe(true);
  });
});

describe('dates', () => {
  it('tells epoch seconds from epoch milliseconds', () => {
    // Guessing wrong dates a campaign to 1970 or to the year 55000.
    expect(toISO(1_755_216_000)).toBe('2025-08-15T00:00:00.000Z');
    expect(toISO(1_755_216_000_000)).toBe('2025-08-15T00:00:00.000Z');
  });

  it('keeps an already-formatted day rather than losing it', () => {
    expect(toDay('2026-08-15')).toBe('2026-08-15');
    expect(toDay('2026-08-15T09:30:00Z')).toBe('2026-08-15');
    expect(toDay('nonsense')).toBe('');
  });
});

describe('retry classification', () => {
  /** A misclassified error either retries a rejected credential forever or writes off
   *  a rate limit that would have succeeded a second later. */
  it('retries only rate limits and server faults', () => {
    expect(isRetryableAdStatus(429)).toBe(true);
    expect(isRetryableAdStatus(503)).toBe(true);
    expect(isRetryableAdStatus(401)).toBe(false);
    expect(isRetryableAdStatus(400)).toBe(false);
  });
});

describe('objective refusal', () => {
  /** Refusing by NAME is the point: a silent fallback would buy awareness with a
   *  leads budget and report success. */
  it('refuses an objective the network cannot serve, and names the ones it can', async () => {
    const meta = getAdsProvider('meta')!;
    expect(meta.objectives).not.toContain('video_views');
    const { call } = calls({});
    await expect(meta.createCampaign(call, { adAccountId: 'act_1' }, {
      name: 'Launch', objective: 'video_views', dailyBudgetCents: 5000,
    }, identity())).rejects.toMatchObject({ status: 400, retryable: false });
  });

  it('refuses a spend on a connection with no account id, without calling the network', async () => {
    const google = getAdsProvider('google')!;
    const { call, seen } = calls({});
    await expect(google.listCampaigns(call, {}, identity())).rejects.toBeInstanceOf(AdsProviderError);
    // A configuration error must never reach the network — and never be retried.
    expect(seen).toHaveLength(0);
  });
});

describe('Meta', () => {
  const meta = getAdsProvider('meta')!;

  it('reads budgets in minor units and spend in major units from the same API', async () => {
    const { call } = calls({
      list_campaigns: { data: [{
        id: '120', name: 'Always on', objective: 'OUTCOME_LEADS', status: 'ACTIVE',
        daily_budget: '5000', start_time: '2026-08-01T00:00:00+0000',
      }] },
    });
    const [campaign] = await meta.listCampaigns(call, { adAccountId: 'act_1' }, identity());
    expect(campaign).toMatchObject({
      externalId: '120', status: 'active', objective: 'leads',
      nativeObjective: 'OUTCOME_LEADS', dailyBudgetCents: 5000,
    });
  });

  it('sums only OUTCOME actions as conversions', async () => {
    const { call } = calls({
      get_insights: { data: [{
        campaign_id: '120', date_start: '2026-08-14', spend: '12.50',
        impressions: '1000', clicks: '40',
        actions: [
          { action_type: 'landing_page_view', value: '900' },
          { action_type: 'offsite_conversion.fb_pixel_lead', value: '7' },
          { action_type: 'lead', value: '3' },
        ],
      }] },
    });
    const [row] = await meta.insights(call, { adAccountId: 'act_1' }, { since: '2026-08-14', until: '2026-08-14' }, identity());
    // 900 landing-page views are NOT conversions; 7 + 3 outcomes are.
    expect(row).toMatchObject({ date: '2026-08-14', spendCents: 1250, clicks: 40, conversions: 10 });
  });

  it('drops an insight row with no campaign or no day rather than guessing its key', async () => {
    const { call } = calls({
      get_insights: { data: [
        { campaign_id: '', date_start: '2026-08-14', spend: '1.00' },
        { campaign_id: '120', date_start: '', spend: '1.00' },
      ] },
    });
    // `(campaign, date)` IS the ledger's identity — a row missing either cannot be
    // stored idempotently, so it is dropped rather than written under a guess.
    expect(await meta.insights(call, { adAccountId: 'act_1' }, { since: '2026-08-14', until: '2026-08-14' }, identity())).toEqual([]);
  });

  it('never starts spending unless asked', async () => {
    const { call, seen } = calls({ create_campaign: { data: { id: '999' } } });
    await meta.createCampaign(call, { adAccountId: 'act_1' }, {
      name: 'Quiet', objective: 'traffic', dailyBudgetCents: 2500,
    }, identity());
    expect(seen[0]!.input.status).toBe('PAUSED');
    expect(seen[0]!.input.daily_budget).toBe(2500);
  });
});

describe('TikTok', () => {
  const tiktok = getAdsProvider('tiktok')!;

  /** TikTok answers 200 with its own error envelope, so HTTP status alone is not
   *  whether the call worked. Reading `data` on a failure would report "no campaigns"
   *  when the truth is "your token expired". */
  it('treats a non-zero code in a 200 as the failure it is', async () => {
    const { call } = calls({ list_campaigns: { data: { code: 40100, message: 'Access token is invalid' } } });
    await expect(tiktok.listCampaigns(call, { adAccountId: '7' }, identity()))
      .rejects.toMatchObject({ retryable: false, message: 'Access token is invalid' });
  });

  it('retries a rate limit but not a rejected credential', async () => {
    const { call } = calls({ list_campaigns: { data: { code: 40016, message: 'Too many requests' } } });
    await expect(tiktok.listCampaigns(call, { adAccountId: '7' }, identity()))
      .rejects.toMatchObject({ retryable: true });
  });

  it('reads the budget against the mode that gives it meaning', async () => {
    const { call } = calls({
      list_campaigns: { data: { code: 0, data: { list: [
        { campaign_id: '5', campaign_name: 'Daily', objective_type: 'TRAFFIC', operation_status: 'ENABLE', budget_mode: 'BUDGET_MODE_DAY', budget: 50 },
        { campaign_id: '6', campaign_name: 'Lifetime', objective_type: 'TRAFFIC', operation_status: 'DISABLE', budget_mode: 'BUDGET_MODE_TOTAL', budget: 500 },
      ] } } },
    });
    const [daily, lifetime] = await tiktok.listCampaigns(call, { adAccountId: '7' }, identity());
    expect(daily).toMatchObject({ status: 'active', dailyBudgetCents: 5000, totalBudgetCents: null });
    expect(lifetime).toMatchObject({ status: 'paused', dailyBudgetCents: null, totalBudgetCents: 50_000 });
  });

  it('sends a status change to its own endpoint, not to update', async () => {
    // Sending status to `campaign/update` is accepted and silently ignored, which is
    // the worst outcome for a pause.
    const { call, seen } = calls({ update_campaign_status: { data: { code: 0, data: {} } } });
    await tiktok.updateCampaign(call, { adAccountId: '7' }, '5', { status: 'paused' }, identity());
    expect(seen.map((s) => s.action)).toEqual(['update_campaign_status']);
    expect(seen[0]!.input.operation_status).toBe('DISABLE');
  });
});

describe('Google', () => {
  const google = getAdsProvider('google')!;

  it('creates the budget before the campaign that must reference it', async () => {
    const { call, seen } = calls({
      mutate_campaign_budgets: { data: [{ resourceName: 'customers/1/campaignBudgets/9' }] },
      mutate_campaigns: { data: [{ resourceName: 'customers/1/campaigns/77' }] },
    });
    const created = await google.createCampaign(call, { adAccountId: '123-456-7890' }, {
      name: 'Search', objective: 'traffic', dailyBudgetCents: 5000,
    }, identity());

    expect(seen.map((s) => s.action)).toEqual(['mutate_campaign_budgets', 'mutate_campaigns']);
    // Digits only — Google rejects the dashed form the UI shows.
    expect(seen[0]!.input.customer_id).toBe('1234567890');
    expect(created.externalId).toBe('77');
  });

  it('refuses to create a campaign with no daily budget rather than failing upstream', async () => {
    const { call, seen } = calls({});
    await expect(google.createCampaign(call, { adAccountId: '1' }, {
      name: 'No budget', objective: 'traffic',
    }, identity())).rejects.toMatchObject({ status: 400, retryable: false });
    expect(seen).toHaveLength(0);
  });

  it('builds a field mask from what was actually set', async () => {
    const { call, seen } = calls({ mutate_campaigns: { data: [{ resourceName: 'customers/1/campaigns/77' }] } });
    await google.updateCampaign(call, { adAccountId: '1' }, '77', { status: 'paused' }, identity());
    const operation = (seen[0]!.input.operations as Array<Record<string, unknown>>)[0]!;
    // A field absent from the mask is IGNORED by Google, so the mask is what makes a
    // patch a patch rather than a silent no-op.
    expect(operation.updateMask).toBe('status');
  });
});

describe('totals', () => {
  it('sums days without inventing a currency', () => {
    const total = totalInsights([
      { date: '2026-08-14', externalCampaignId: '1', spendCents: 1000, impressions: 10, clicks: 2, conversions: 1, currency: 'EUR' },
      { date: '2026-08-15', externalCampaignId: '1', spendCents: 500, impressions: 5, clicks: 1, conversions: 0, currency: 'EUR' },
    ]);
    expect(total).toEqual({ spendCents: 1500, impressions: 15, clicks: 3, conversions: 1, currency: 'EUR' });
  });
});
