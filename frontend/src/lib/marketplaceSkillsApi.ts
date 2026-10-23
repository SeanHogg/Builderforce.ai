/**
 * Publishing skills to the marketplace — create, update and export a listing,
 * optionally from an Agent Skills folder. Split out of `builderforceApi.ts`, which
 * keeps the publisher credential (`mpRequest`) every marketplace call shares.
 */

import type { SkillFile } from '@builderforce/agent-skills';
import { apiRequest } from './apiClient';
import { mpRequest, type MarketplaceSkill } from './builderforceApi';

export interface MarketplaceSkillDraft {
  name: string;
  slug: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
  repoUrl?: string;
  iconUrl?: string;
  /** Dollars (the server stores cents). */
  price?: number;
  pricingModel?: 'flat_fee' | 'consumption';
  priceUnit?: string;
  /**
   * The skill as an Agent Skills folder (SKILL.md + bundled files). When sent, the
   * server derives the listing's slug, description and readme FROM it, so the card
   * and the folder an installer receives cannot disagree.
   */
  files?: SkillFile[];
}

// Publishing only. Sign-in, sign-up and "who am I" are the ONE web auth client
// (`/api/auth/web/*`, `/api/auth/me`); the old `/marketplace/auth/*` doors are
// server-side aliases of those routes and had no caller here.
/**
 * The draft as the route reads it. `/marketplace/skills` takes snake_case
 * (`repo_url`, `icon_url`, `pricing_model`, `price_unit`); the draft used to be sent
 * as-is, so the repo link, icon and every pricing field were silently dropped.
 */
function skillDraftBody(d: Partial<MarketplaceSkillDraft>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: d.name, slug: d.slug, description: d.description, category: d.category, tags: d.tags, version: d.version,
    repo_url: d.repoUrl, icon_url: d.iconUrl, price: d.price, pricing_model: d.pricingModel, price_unit: d.priceUnit, files: d.files,
  };
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

export const marketplacePublisherApi = {
  publishSkill: (skill: MarketplaceSkillDraft) =>
    mpRequest<{ skill: MarketplaceSkill }>('/marketplace/skills', {
      method: 'POST',
      body: JSON.stringify(skillDraftBody(skill)),
      // 409 = the slug is listed already; a caller that republishes updates it instead.
      expectedErrors: [409, 422],
    }),

  updateSkill: (slug: string, updates: Partial<MarketplaceSkillDraft> & { published?: boolean }) =>
    mpRequest<{ skill: MarketplaceSkill }>(`/marketplace/skills/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ ...skillDraftBody(updates), ...(updates.published !== undefined ? { published: updates.published } : {}) }),
      expectedErrors: [422],
    }),

  /** A published skill as an Agent Skills folder (public, counted as a download). */
  exportSkill: (slug: string) =>
    apiRequest<{ name: string; files: SkillFile[] }>(`/marketplace/skills/${encodeURIComponent(slug)}/export`, { auth: 'none' }),

  // Likes are NOT here: every like button calls `marketplaceStats.toggleLike`
  // (POST /api/marketplace-stats/like), the one like store.
};
