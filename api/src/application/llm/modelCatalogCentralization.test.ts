/**
 * Model versions live in ONE place: the vendor catalogs (`vendors/*.ts`). Every routing
 * list derives from them — flagships (`VendorModule.flagships`) and version bumps
 * (`VendorModelEntry.supersedes`). These guards fail the build when a list starts
 * naming a model version again, or when a catalog declaration stops resolving.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allVendorFlagships,
  catalogSupersessions,
  getCatalog,
  getModule,
  parseVendorPrefix,
  vendorForModel,
} from './vendors';
import { BYO_FRONTIER_CODERS, CODING_PREMIUM_FALLBACK_MODELS, SUPERSEDED_MODEL_IDS, canonicalModelId } from './modelPool';

/** A Claude version string in either namespace: `claude-opus-5-5`, `anthropic/claude-sonnet-5.5`. */
const CLAUDE_VERSION_LITERAL = /['"`](?:anthropic\/)?claude-[a-z]+-\d/;

describe('model catalog centralization', () => {
  it.each(['modelPool.ts', 'poolRouting.ts'])('%s names no Claude version — it derives from the catalogs', (file) => {
    const source = readFileSync(resolve(__dirname, file), 'utf8')
      // Comments may cite a model for context; only code is held to the rule.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(CLAUDE_VERSION_LITERAL);
  });

  it('every declared flagship routes to its own vendor and names a catalog entry', () => {
    for (const { vendor, agentic, chat } of allVendorFlagships()) {
      for (const routed of [agentic, chat]) {
        expect(vendorForModel(routed), `${vendor} flagship ${routed}`).toBe(vendor);
        const bare = parseVendorPrefix(routed)?.modelId ?? routed;
        const ids = getModule(vendor).catalog.map((entry) => entry.id);
        expect(ids, `${vendor} flagship ${routed}`).toContain(bare);
      }
    }
  });

  it('no old id is claimed by two catalog entries (the fold would silently keep one)', () => {
    const claimedBy = new Map<string, string>();
    for (const entry of getCatalog()) {
      for (const oldId of entry.supersedes ?? []) {
        const key = `${entry.vendor}:${oldId}`;
        expect(claimedBy.get(key), `${oldId} claimed by ${claimedBy.get(key)} and ${entry.id}`).toBeUndefined();
        claimedBy.set(key, entry.id);
      }
    }
  });

  it('every supersession resolves to a live catalog entry', () => {
    for (const [oldId, successor] of Object.entries(catalogSupersessions())) {
      const vendor = vendorForModel(successor);
      const bare = parseVendorPrefix(successor)?.modelId ?? successor;
      expect(getModule(vendor).catalog.map((entry) => entry.id), `${oldId} -> ${successor}`).toContain(bare);
    }
  });

  it('the exported rewrite map IS the catalog fold, and old pins resolve to the current flagship', () => {
    expect(SUPERSEDED_MODEL_IDS).toEqual(catalogSupersessions());
    const anthropic = getModule('anthropic').flagships!;
    expect(canonicalModelId('claude-opus-4-8')).toBe(anthropic.agentic);
    expect(canonicalModelId('claude-sonnet-4-6')).toBe(anthropic.chat);
  });

  it('flagship-derived routing lists carry the current Anthropic flagships', () => {
    const anthropic = getModule('anthropic').flagships!;
    expect(CODING_PREMIUM_FALLBACK_MODELS).toEqual(expect.arrayContaining([anthropic.chat, anthropic.agentic]));
    expect(BYO_FRONTIER_CODERS).toEqual(expect.arrayContaining([anthropic.chat, anthropic.agentic]));
  });
});
