/**
 * `replay_prescriptions.visual` (PRD 33 §5.2 "Render") — building it, reading it back
 * as `ReplayVisualDto`, and the SERP / JSON-LD halves of an SEO meta change. Pure.
 *
 * A page-review fix's visual is written in two steps: the drafter stores the
 * VALIDATED patch (and, for an SEO meta change, the SERP before/after and the JSON-LD
 * diff) with no after screenshots; the `page_render_after` callback then adds the
 * after-render URLs. A visual that does not parse reads as null — never a guess.
 */

import {
  patchCallouts,
  type ReplayPageSeoFacts,
  type ReplaySerpSnippet,
  type ReplayVisualDto,
  type VisualPatch,
} from '@builderforce/interaction-contract';
import { asJsonObject, asJsonRecord } from '../../domain/shared/json';

const SERP_TITLE_MAX = 70;
const SERP_DESCRIPTION_MAX = 170;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function snippetOf(raw: unknown): ReplaySerpSnippet | null {
  const s = asJsonObject<Record<string, unknown>>(raw);
  if (!s || typeof s.title !== 'string' || typeof s.url !== 'string') return null;
  return { title: s.title, url: s.url, description: str(s.description) };
}

/** Read a stored visual as the contract DTO, or null. */
export function visualOf(raw: unknown): ReplayVisualDto | null {
  const v = asJsonObject<Record<string, unknown>>(raw);
  if (!v) return null;
  const patch = asJsonObject<{ ops?: unknown }>(v.patch);
  if (!patch || !Array.isArray(patch.ops)) return null;
  const urls = asJsonRecord(v.afterScreenshotUrls);
  const serp = asJsonObject<Record<string, unknown>>(v.serp);
  const before = serp ? snippetOf(serp.before) : null;
  const after = serp ? snippetOf(serp.after) : null;
  const callouts = Array.isArray(v.callouts)
    ? v.callouts.map(asJsonRecord).filter((c) => typeof c.selector === 'string' && typeof c.n === 'number').map((c) => ({ n: c.n as number, selector: c.selector as string }))
    : [];
  return {
    patch: patch as VisualPatch,
    afterScreenshotUrls: {
      ...(typeof urls.desktop === 'string' ? { desktop: urls.desktop } : {}),
      ...(typeof urls.phone === 'string' ? { phone: urls.phone } : {}),
    },
    ...(before && after ? { serp: { before, after } } : {}),
    ...(typeof v.jsonLdDiff === 'string' ? { jsonLdDiff: v.jsonLdDiff } : {}),
    callouts,
  };
}

/** The Google result a capture reads as today. */
export function serpBefore(seo: ReplayPageSeoFacts | null, url: string): ReplaySerpSnippet {
  return {
    title: (seo?.title ?? '').slice(0, SERP_TITLE_MAX),
    url,
    description: (seo?.metaDescription ?? '').slice(0, SERP_DESCRIPTION_MAX),
  };
}

/** A `+`-prefixed diff of the JSON-LD a fix adds (the page had `beforeTypes`). */
export function jsonLdDiff(beforeTypes: readonly string[], added: unknown): string {
  const lines = [
    ...beforeTypes.map((t) => `  @type ${t}`),
    ...JSON.stringify(added, null, 2).split('\n').map((l) => `+ ${l}`),
  ];
  return lines.join('\n').slice(0, 4_000);
}

/** A fresh visual: the validated patch, its callouts, no after renders yet. */
export function buildVisual(
  patch: VisualPatch,
  extra: { serp?: { before: ReplaySerpSnippet; after: ReplaySerpSnippet }; jsonLdDiff?: string } = {},
): ReplayVisualDto {
  return {
    patch,
    afterScreenshotUrls: {},
    ...(extra.serp ? { serp: extra.serp } : {}),
    ...(extra.jsonLdDiff ? { jsonLdDiff: extra.jsonLdDiff } : {}),
    callouts: patchCallouts(patch),
  };
}

/** True when the visual's patch has DOM ops worth rendering (an SEO meta change has none). */
export const hasRenderableOps = (visual: ReplayVisualDto | null): visual is ReplayVisualDto => !!visual && visual.patch.ops.length > 0;
