/**
 * Creative generation — /api/creative/*
 *
 * Canvas advertises a creative capability per object kind (`creative.cad`,
 * `creative.game`, …). Those capabilities used to be honoured entirely in the
 * browser by a parameterised primitive: a real, portable file for every kind, but
 * a fixed plate for every CAD brief and a fixed box for every 3D brief, with no
 * model behind any of it. This route is the generator those capabilities name.
 *
 * Two shapes of work, split by what can be validated:
 *
 *  - GEOMETRY (`cad`, `model3d`) — the model authors a bounded parametric SPEC
 *    and the server evaluates it into DXF or STL. Asking a model for DXF or STL
 *    text directly yields files that are plausible and frequently unopenable, so
 *    the shape comes from the model and the file comes from code that can only
 *    emit well-formed geometry. See `application/creative/geometryService`.
 *
 *  - AUTHORED (`game`, `resume`, `podcast`, `template`) — the deliverable IS text,
 *    so the model writes the file and the server checks it is the kind of file it
 *    claims to be before handing it back.
 *
 * Image, comic and animation are not here: those are rendered by the tenant's own
 * published Evermind media model, which the client calls directly.
 *
 * Everything runs on the FREE pool (`ideProxy`), so honouring a creative brief
 * never lands on a paid vendor. Any failure returns 502 and the caller falls back
 * to the browser baseline — a creative object must always end up with a file.
 *
 * Not cached: a generative call keyed on a free-text brief.
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import { ideProxy, readProxyChoice } from '../../application/llm/LlmProxyService';
import {
  GEOMETRY_RESPONSE_SCHEMAS,
  GEOMETRY_SYSTEM_PROMPTS,
  dxfFromProfile,
  facetCount,
  readCadSpec,
  readModel3dSpec,
  stlFromSolids,
} from '../../application/creative/geometryService';

/** Every kind this route can generate, and what it produces. */
const KINDS = {
  cad: { artifactKind: 'cad', extension: 'dxf', mimeType: 'application/dxf', outputFormat: 'DXF' },
  model3d: { artifactKind: 'model3d', extension: 'stl', mimeType: 'model/stl', outputFormat: 'STL' },
  game: { artifactKind: 'game', extension: 'html', mimeType: 'text/html', outputFormat: 'HTML' },
  resume: { artifactKind: 'resume', extension: 'md', mimeType: 'text/markdown', outputFormat: 'Markdown' },
  podcast: { artifactKind: 'podcast-script', extension: 'md', mimeType: 'text/markdown', outputFormat: 'Markdown script' },
  template: { artifactKind: 'template', extension: 'json', mimeType: 'application/json', outputFormat: 'JSON' },
} as const;

type CreativeKind = keyof typeof KINDS;

const AUTHORING_PROMPTS: Record<'game' | 'resume' | 'podcast' | 'template', string> = {
  game: 'You write small, complete browser games. Reply with ONE self-contained HTML document — inline CSS and JS, '
    + 'no external files, no network — that actually plays the game described in the brief: real rules, real input '
    + 'handling, a win or lose state, and a visible score or objective. Reply with the HTML only, no commentary.',
  resume: 'You write resumes. Reply with a complete Markdown resume for the person and role described in the brief: '
    + 'a summary, experience with measurable achievements, skills, and education. Use only facts the brief supports '
    + 'and clearly bracketed placeholders where it gives none. Reply with the Markdown only.',
  podcast: 'You write podcast scripts. Reply with a complete Markdown script for the episode described in the brief: '
    + 'a cold open, segments with speaker cues and actual spoken lines, transitions, and an outro. '
    + 'Reply with the Markdown only.',
  template: 'You design reusable content templates. Reply with a JSON object describing the template the brief asks '
    + 'for: an id, a name, a description, and a `fields` array where each field has a key, a label, a type '
    + '(text, textarea, number, date, select) and, for select, its options. Reply with JSON only.',
};

/** Token ceilings per kind. A game is a document; a spec is a page of numbers. */
const MAX_TOKENS: Record<CreativeKind, number> = {
  cad: 1600, model3d: 1600, game: 6000, resume: 2400, podcast: 3200, template: 1600,
};

function fileSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'builderforce-artifact';
}

/** Models fence code even when told not to; the fence is not part of the file. */
function stripFence(text: string): string {
  const fenced = /^\s*```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

export function createCreativeRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * POST /api/creative/generate
   * Body: { kind, title, brief, templateId? }
   * → { artifactKind, fileName, mimeType, outputFormat, content, provider, model, validationDetail, summary? }
   */
  router.post('/generate', async (c) => {
    const body = await c.req.json<{ kind?: unknown; title?: unknown; brief?: unknown; templateId?: unknown }>().catch(() => ({}));
    const kind = String(body.kind ?? '') as CreativeKind;
    const target = KINDS[kind];
    if (!target) return c.json({ error: 'Unsupported creative kind', kind: String(body.kind ?? '') }, 400);

    const title = String(body.title ?? '').trim().slice(0, 200) || kind;
    const brief = String(body.brief ?? '').trim().slice(0, 8000);
    if (!brief) return c.json({ error: 'A brief is required to generate this deliverable' }, 400);
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim().slice(0, 120) : '';
    const stem = fileSafe(title);

    const geometry = kind === 'cad' || kind === 'model3d';
    const userPrompt = `Title: ${title}\n${templateId ? `Template: ${templateId}\n` : ''}Brief: ${brief}`;

    let result;
    try {
      result = await ideProxy(c.env).complete({
        messages: [
          { role: 'system', content: geometry ? GEOMETRY_SYSTEM_PROMPTS[kind] : AUTHORING_PROMPTS[kind] },
          { role: 'user', content: userPrompt },
        ],
        temperature: geometry ? 0.2 : 0.7,
        max_tokens: MAX_TOKENS[kind],
        ...(geometry ? { response_format: GEOMETRY_RESPONSE_SCHEMAS[kind] } : {}),
        ...(kind === 'template' ? { response_format: { type: 'json_object' as const } } : {}),
        useCase: `creative_${kind}`,
      });
    } catch (err) {
      return c.json({ error: 'Creative generation failed', detail: err instanceof Error ? err.message : String(err) }, 502);
    }
    if (result.response.status >= 400) return c.json({ error: 'Creative generation is unavailable' }, 502);
    const { content } = await readProxyChoice(result);
    if (!content.trim()) return c.json({ error: 'The generator returned nothing' }, 502);

    const common = {
      artifactKind: target.artifactKind,
      fileName: `${stem}${kind === 'podcast' ? '-script' : ''}.${target.extension}`,
      mimeType: target.mimeType,
      outputFormat: target.outputFormat,
      provider: geometry ? 'builderforce-geometry' : 'builderforce-authoring',
      model: result.resolvedModel,
    };

    if (geometry) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return c.json({ error: 'The geometry generator did not return a readable spec' }, 502);
      }
      if (kind === 'cad') {
        const spec = readCadSpec(parsed);
        if (!spec) return c.json({ error: 'The generated profile was not a drawable outline' }, 502);
        return c.json({
          ...common,
          content: dxfFromProfile(spec),
          validationDetail: `Closed ${spec.outline.length}-point DXF profile with ${spec.holes?.length ?? 0} bore(s), generated from the brief and evaluated on the server`,
          summary: spec.summary ?? null,
        });
      }
      const spec = readModel3dSpec(parsed);
      if (!spec) return c.json({ error: 'The generated model had no buildable solids' }, 502);
      const facets = facetCount(spec);
      if (!facets) return c.json({ error: 'The generated model tessellated to nothing' }, 502);
      return c.json({
        ...common,
        content: stlFromSolids(stem, spec),
        validationDetail: `Closed ${facets}-facet ASCII STL from ${spec.solids.length} primitive(s), generated from the brief and evaluated on the server`,
        summary: spec.summary ?? null,
      });
    }

    const file = stripFence(content);
    // The file has to BE what it claims to be. A refusal, an apology or a stray
    // paragraph is not an artifact, and shipping it as one is the failure this
    // route exists to remove.
    if (kind === 'game' && !/<[a-z!]/i.test(file)) return c.json({ error: 'The generated game was not an HTML document' }, 502);
    if (kind === 'template') {
      try {
        JSON.parse(file);
      } catch {
        return c.json({ error: 'The generated template was not valid JSON' }, 502);
      }
    }
    if (file.length < 40) return c.json({ error: 'The generated deliverable was too short to be usable' }, 502);

    return c.json({
      ...common,
      content: kind === 'game' && !/^\s*<!doctype/i.test(file) ? `<!doctype html>\n${file}` : file,
      validationDetail: `${target.outputFormat} deliverable generated from the brief and checked for shape (${file.length} characters)`,
      summary: null,
    });
  });

  return router;
}
