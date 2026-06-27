/**
 * Limbic gateway route.
 *
 * Surfaces the shared, Worker-safe limbic compiler (`@builderforce/agent-tools`)
 * over HTTP so clients that cannot bundle the workspace module — notably the
 * VS Code extension's built-in agent (packaged with `--no-dependencies`) — can
 * still execute under the same affective layer as every other surface. The
 * gateway "injects" the affective directive block; the client prepends it to its
 * system prompt.
 *
 * NOT cached: the handler is a pure in-memory regex appraisal of the supplied
 * text (no DB / external call), so a read-through cache round-trip would cost
 * more than recomputing. The single source of truth for the logic is the shared
 * compiler — this route adds no behaviour, only transport.
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import { appraiseTask, buildLimbicBlock, neutralState } from '@builderforce/agent-tools';

export function createLimbicRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * POST /api/limbic/block
   * Body: { text: string }  — the task/request text to appraise.
   * Returns: { block: string } — the affective directive block ('' at rest).
   */
  router.post('/block', authMiddleware, async (c) => {
    let text = '';
    try {
      const body = (await c.req.json()) as { text?: unknown };
      if (typeof body.text === 'string') text = body.text;
    } catch {
      /* empty / non-JSON body → neutral appraisal */
    }
    const state = appraiseTask(text, neutralState());
    return c.json({ block: buildLimbicBlock(state) });
  });

  return router;
}
