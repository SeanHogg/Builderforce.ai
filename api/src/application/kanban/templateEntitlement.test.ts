import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicTemplate: vi.fn(),
  heldLicence: vi.fn(),
}));

vi.mock('../templates/catalogTemplateStore', () => ({ getPublicTemplate: mocks.getPublicTemplate }));
vi.mock('../marketplace/listingCommerce', () => ({ heldLicence: mocks.heldLicence }));

import {
  assertTemplateEntitled,
  lockedTemplateListing,
  licenceRequiredBody,
  TemplateLicenceRequiredError,
} from './templateEntitlement';
import { previewOf } from './templatePreview';

const db = {} as never;
const PUBLIC_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 99,
  slug: 'agency-board-abc123',
  name: 'Agency board',
  priceCents: 1500,
  currency: 'usd',
};

describe('assertTemplateEntitled', () => {
  beforeEach(() => {
    mocks.getPublicTemplate.mockReset();
    mocks.heldLicence.mockReset();
  });

  it('refuses a priced foreign template the tenant holds no licence for, carrying the listing', async () => {
    mocks.getPublicTemplate.mockResolvedValue(PUBLIC_ROW);
    mocks.heldLicence.mockResolvedValue(null);
    const err = await assertTemplateEntitled(db, undefined, { tenantId: 1, buyerRef: 'u1', templateId: PUBLIC_ROW.id })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TemplateLicenceRequiredError);
    expect(licenceRequiredBody(err)).toMatchObject({
      checkoutRequired: true,
      priceCents: 1500,
      listingSlug: 'agency-board-abc123',
      checkoutPath: '/api/creation-listings/agency-board-abc123/checkout',
    });
    expect(mocks.heldLicence).toHaveBeenCalledWith(db, 1, 'u1', PUBLIC_ROW.id);
  });

  it('applies once completeListingCheckout has granted the licence', async () => {
    mocks.getPublicTemplate.mockResolvedValue(PUBLIC_ROW);
    mocks.heldLicence.mockResolvedValue({ id: 5, snapshotId: null });
    await expect(
      assertTemplateEntitled(db, undefined, { tenantId: 1, buyerRef: 'u1', templateId: PUBLIC_ROW.id }),
    ).resolves.toBeUndefined();
  });

  it('refuses a system actor (no user) on a priced foreign template', async () => {
    mocks.getPublicTemplate.mockResolvedValue(PUBLIC_ROW);
    await expect(
      assertTemplateEntitled(db, undefined, { tenantId: 1, buyerRef: null, templateId: PUBLIC_ROW.id }),
    ).rejects.toBeInstanceOf(TemplateLicenceRequiredError);
    expect(mocks.heldLicence).not.toHaveBeenCalled();
  });

  it('lets a free template through without a licence read', async () => {
    mocks.getPublicTemplate.mockResolvedValue({ ...PUBLIC_ROW, priceCents: 0 });
    await expect(
      assertTemplateEntitled(db, undefined, { tenantId: 1, buyerRef: 'u1', templateId: PUBLIC_ROW.id }),
    ).resolves.toBeUndefined();
    expect(mocks.heldLicence).not.toHaveBeenCalled();
  });

  it("lets the author's own priced template through", async () => {
    mocks.getPublicTemplate.mockResolvedValue({ ...PUBLIC_ROW, tenantId: 1 });
    await expect(
      assertTemplateEntitled(db, undefined, { tenantId: 1, buyerRef: 'u1', templateId: PUBLIC_ROW.id }),
    ).resolves.toBeUndefined();
    expect(mocks.heldLicence).not.toHaveBeenCalled();
  });

  it('lets a built-in or a private (non-public) template through', async () => {
    mocks.getPublicTemplate.mockResolvedValue(null);
    await expect(
      assertTemplateEntitled(db, undefined, { tenantId: 1, buyerRef: 'u1', templateId: PUBLIC_ROW.id }),
    ).resolves.toBeUndefined();
  });
});

describe('lockedTemplateListing + previewOf', () => {
  beforeEach(() => {
    mocks.getPublicTemplate.mockReset();
    mocks.heldLicence.mockReset();
  });

  it('returns the listing for a priced foreign template and null once licensed', async () => {
    mocks.getPublicTemplate.mockResolvedValue(PUBLIC_ROW);
    mocks.heldLicence.mockResolvedValueOnce(null);
    expect(await lockedTemplateListing(db, undefined, { tenantId: 1, buyerRef: 'u1', templateId: PUBLIC_ROW.id }))
      .toMatchObject({ priceCents: 1500, slug: 'agency-board-abc123' });
    mocks.heldLicence.mockResolvedValueOnce({ id: 1, snapshotId: null });
    expect(await lockedTemplateListing(db, undefined, { tenantId: 1, buyerRef: 'u1', templateId: PUBLIC_ROW.id })).toBeNull();
  });

  it('preview carries lane names only, never requirements, staffing or gates', () => {
    const p = previewOf(
      {
        id: 't', slug: 's', name: 'N', description: 'd', category: 'c', builtin: false, visibility: 'public',
        published: true, installCount: 0, version: 1,
        lanes: [{ key: 'build', name: 'Build', position: 1, isTerminal: false, gate: 'auto', requirementGate: 'all',
          requirements: [{ kind: 'role', ref: 'secret-role', isRequired: true, position: 0 }] }],
      } as never,
      { listingId: 'l', slug: 'ls', name: 'N', priceCents: 900, currency: 'usd' },
    );
    expect(p).toMatchObject({ preview: true, priceCents: 900, lanes: [{ key: 'build', name: 'Build', position: 1 }] });
    expect(JSON.stringify(p)).not.toContain('secret-role');
    expect(p.lanes[0]).not.toHaveProperty('gate');
    expect(p.lanes[0]).not.toHaveProperty('requirements');
  });
});
