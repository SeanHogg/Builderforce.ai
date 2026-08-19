/**
 * The document templates — the catalogue, the render, and the send (FO-D5).
 *
 * Three endpoints over `documentTemplates.ts` and `templateSigning.ts`, and the
 * split between the last two is the whole design:
 *
 *   GET  /api/document-templates                  what exists, and what each asks for
 *   POST /api/document-templates/:key/render      the text, and nothing else
 *   POST /api/document-templates/:key/send        the text, sent for signature
 *
 * `render` writes nothing. It exists so a founders' agreement can be DRAFTED onto
 * a canvas `contract` card, read, argued about and edited before anybody is asked
 * to sign it — which is exactly what `contract.sign` being an approval-gated act
 * already assumes. `send` is the one-call path for a surface that has already
 * collected the detail and is ready.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  TemplateError,
  documentTemplateCatalog,
  renderDocumentTemplate,
  type TemplateValues,
} from '../../application/legal/documentTemplates';
import { sendTemplatedDocument } from '../../application/legal/templateSigning';
import { SignatureError } from '../../application/signature/signatureEngine';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TemplateError || error instanceof SignatureError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

/** The template's variables arrive as an untyped object because they ARE untyped —
 *  each template declares its own. Validation is the template's own job
 *  (`renderDocumentTemplate` refuses on a missing required variable and names it),
 *  so re-checking here would be a second, weaker copy of that rule. */
const values = (body: Record<string, unknown>): TemplateValues =>
  (body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : {}) as TemplateValues;

export function createDocumentTemplateRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/', (c) => Response.json({ templates: documentTemplateCatalog() }));

  router.post('/:key/render', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json({ document: renderDocumentTemplate(c.req.param('key'), values(body)) });
  }));

  router.post('/:key/send', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const result = await sendTemplatedDocument(db, c.env as Env, c.get('tenantId') as number, {
      templateKey: c.req.param('key'),
      values: values(body),
      // Omitted means the signers ARE the parties the document names — the default
      // that cannot disagree with the text.
      ...(Array.isArray(body.parties)
        ? {
            parties: body.parties.flatMap((raw) => {
              const party = raw as { name?: unknown; email?: unknown; partyRef?: unknown };
              return typeof party.name === 'string' && typeof party.email === 'string'
                ? [{ name: party.name, email: party.email, partyRef: typeof party.partyRef === 'string' ? party.partyRef : null }]
                : [];
            }),
          }
        : {}),
      objectId: typeof body.objectId === 'string' ? body.objectId : null,
      subject: typeof body.subject === 'string' ? body.subject : null,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      ...(Number.isFinite(body.remindAfterDays) ? { remindAfterDays: Number(body.remindAfterDays) } : {}),
      createdBy: (c.get('userId') as string | undefined) ?? null,
    });
    return Response.json(result);
  }));

  return router;
}
