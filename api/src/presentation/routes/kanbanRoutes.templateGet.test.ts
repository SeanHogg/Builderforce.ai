/**
 * GET /templates/:id wire shape: ALWAYS `{ template }`, where `template` is the full template
 * or a `{ preview: true, … }` projection for a locked priced one; 404 when absent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const getForViewer = vi.fn();
vi.mock('../../application/kanban/kanbanTemplateService', () => ({
  KanbanTemplateService: class { getForViewer = getForViewer; },
}));

const { createKanbanRoutes } = await import('./kanbanRoutes');

function app() {
  const a = new Hono<HonoEnv>();
  a.use('*', async (c, next) => {
    c.set('isEmulation', true);
    c.set('tenantId', 5);
    c.set('userId', 'user-1');
    c.set('role', 'developer');
    await next();
  });
  a.route('/', createKanbanRoutes({} as unknown as Db));
  return a;
}

describe('GET /templates/:id', () => {
  beforeEach(() => getForViewer.mockReset());

  it('wraps a full template in { template }', async () => {
    getForViewer.mockResolvedValue({ template: { id: 't1', lanes: [] } });
    const res = await app().request('/templates/t1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ template: { id: 't1', lanes: [] } });
    expect(getForViewer.mock.calls[0].slice(1)).toEqual([5, 't1', 'user-1']);
  });

  it('wraps a preview in { template } carrying the preview discriminator', async () => {
    getForViewer.mockResolvedValue({ template: { preview: true, id: 't2', lanes: [{ key: 'a', name: 'A', position: 1 }] } });
    const body = await (await app().request('/templates/t2')).json() as { template: { preview?: boolean } };
    expect(body.template.preview).toBe(true);
  });

  it('answers 404 when absent', async () => {
    getForViewer.mockResolvedValue(null);
    expect((await app().request('/templates/nope')).status).toBe(404);
  });
});
