import { describe, expect, it } from 'vitest';
import { COMMERCE_WIDGET_JS, SITE_COMMERCE_WIDGET_PATH, commerceWidgetResponse } from './siteCommerceWidget';

describe('the commerce widget script', () => {
  it('is syntactically valid JavaScript', () => {
    // `new Function` parses without running — it throws on a syntax error (the
    // exact class of bug a hand-written template string is prone to) without
    // needing `document`/`fetch`/`location`, none of which exist in this test's
    // environment.
    expect(() => new Function(COMMERCE_WIDGET_JS)).not.toThrow();
  });

  it('talks to the public listing and me endpoints, never a hardcoded price', () => {
    expect(COMMERCE_WIDGET_JS).toContain('billing/listing');
    expect(COMMERCE_WIDGET_JS).toContain('billing/me');
    expect(COMMERCE_WIDGET_JS).toContain('billing/subscribe');
    expect(COMMERCE_WIDGET_JS).toContain('billing/complete');
    expect(COMMERCE_WIDGET_JS).toContain('billing/accept-update');
  });

  it('never renders when there is nothing priced to sell', () => {
    expect(COMMERCE_WIDGET_JS).toMatch(/listing\.priceCents>0/);
  });

  it('escapes what it renders — a listing name is creator-authored', () => {
    expect(COMMERCE_WIDGET_JS).toContain('function esc(');
  });
});

describe('commerceWidgetResponse', () => {
  it('is cacheable — the same bytes serve every paid app on the platform', async () => {
    const response = commerceWidgetResponse();
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(response.headers.get('cache-control')).toContain('public');
    expect(await response.text()).toBe(COMMERCE_WIDGET_JS);
  });
});

describe('SITE_COMMERCE_WIDGET_PATH', () => {
  it('is the same path the module answers under `billing/`', () => {
    expect(SITE_COMMERCE_WIDGET_PATH).toBe('/__api/billing/widget.js');
  });
});
