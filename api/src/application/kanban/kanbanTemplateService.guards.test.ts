import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getPublicTemplate: vi.fn(),
  getTenantTemplate: vi.fn(),
  insertTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  heldLicence: vi.fn(),
}));

vi.mock('../templates/catalogTemplateStore', () => ({
  getPublicTemplate: m.getPublicTemplate,
  getTenantTemplate: m.getTenantTemplate,
  insertTemplate: m.insertTemplate,
  updateTemplate: m.updateTemplate,
  deleteTemplateRow: vi.fn(),
  listPublicTemplates: vi.fn(),
  listTenantTemplates: vi.fn(),
  recordTemplateInstall: vi.fn(),
}));
vi.mock('../marketplace/listingCommerce', () => ({ heldLicence: m.heldLicence }));
vi.mock('../swimlane/findOrCreateBoard', () => ({ findOrCreateBoard: vi.fn() }));
vi.mock('../swimlane/seedLaneStaffing', () => ({ seedLaneStaffingFromWorkforce: vi.fn() }));
vi.mock('../swimlane/laneOrdinals', () => ({ invalidateSwimlaneOrdinals: vi.fn() }));
vi.mock('../swimlane/boardReads', () => ({ invalidateBoardLanesCache: vi.fn() }));

import { KanbanTemplateService } from './kanbanTemplateService';
import { TemplateLicenceRequiredError } from './templateEntitlement';

/** The `values` the first `updateTemplate` call wrote; fails the test when it was never called. */
function firstUpdateValues(): Record<string, unknown> {
  const call = m.updateTemplate.mock.calls[0];
  expect(call).toBeDefined();
  if (!call) throw new Error('updateTemplate was not called');
  return (call[2] as { values: Record<string, unknown> }).values;
}

const FOREIGN = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 99,
  slug: 'agency-abc',
  name: 'Agency',
  summary: 'sum',
  category: 'software',
  version: '1',
  visibility: 'public',
  priceCents: 1500,
  currency: 'usd',
  publisherRef: 'author',
  createdBy: 'author',
  installCount: 0,
  publishedAt: '2026-01-01T00:00:00.000Z',
  body: {
    lanes: [{
      key: 'build', name: 'Build', position: 1, isTerminal: false, gate: 'auto', requirementGate: 'all',
      requirements: [{ kind: 'role', ref: 'secret-role', isRequired: true, position: 0 }],
    }],
  },
};

describe('KanbanTemplateService paywall + seller guards', () => {
  const svc = new KanbanTemplateService({} as never);
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.getTenantTemplate.mockResolvedValue(null);
    m.getPublicTemplate.mockResolvedValue(FOREIGN);
    m.heldLicence.mockResolvedValue(null);
  });

  it('refuses to fork a priced foreign template without a licence', async () => {
    await expect(svc.create({} as never, 1, 'u1', { name: 'Mine', forkFrom: FOREIGN.id }))
      .rejects.toBeInstanceOf(TemplateLicenceRequiredError);
    expect(m.insertTemplate).not.toHaveBeenCalled();
  });

  it('serves a lane-name-only preview of a locked foreign template', async () => {
    const r = await svc.getForViewer({} as never, 1, FOREIGN.id, 'u1');
    const t = r!.template as unknown as { preview?: boolean; lanes: unknown[] };
    expect(t.preview).toBe(true);
    expect(JSON.stringify(r)).not.toContain('secret-role');
    expect(t.lanes).toEqual([{ key: 'build', name: 'Build', position: 1 }]);
  });

  it('serves the full template once licensed', async () => {
    m.heldLicence.mockResolvedValue({ id: 1, snapshotId: null });
    const r = await svc.getForViewer({} as never, 1, FOREIGN.id, 'u1');
    expect(JSON.stringify(r)).toContain('secret-role');
  });

  it('publish does not let another manager overwrite an existing publisherRef', async () => {
    m.getTenantTemplate.mockResolvedValue({ ...FOREIGN, tenantId: 1 });
    await svc.setPublication({} as never, 1, FOREIGN.id, { published: true, publisherRef: 'mallory' });
    expect(firstUpdateValues()).not.toHaveProperty('publisherRef');
  });

  it('publish lets the author re-publish and claims an unclaimed row', async () => {
    m.getTenantTemplate.mockResolvedValue({ ...FOREIGN, tenantId: 1 });
    await svc.setPublication({} as never, 1, FOREIGN.id, { published: true, publisherRef: 'author' });
    expect(firstUpdateValues().publisherRef).toBe('author');
    m.updateTemplate.mockReset();
    m.getTenantTemplate.mockResolvedValue({ ...FOREIGN, tenantId: 1, publisherRef: null });
    await svc.setPublication({} as never, 1, FOREIGN.id, { published: true, publisherRef: 'mgr' });
    expect(firstUpdateValues().publisherRef).toBe('mgr');
  });
});
