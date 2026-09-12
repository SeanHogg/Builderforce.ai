import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import type { CopyReader } from './copy';
import {
  INTEGRATION_CAPABILITY_PROOF,
  MARKETING_CLAIMS,
  PRODUCT_CAPABILITY_OPERATIONS,
  PRODUCT_CAPABILITY_PROOF,
  PRODUCT_SECTIONS,
  WORKFLOW_PROOF_DEMOS,
  operationsKey,
  prerequisiteKey,
} from './product';

const repositoryRoot = resolve(process.cwd(), '..');
const assertEvidenceExists = (paths: readonly string[]) => {
  for (const path of paths) expect(existsSync(resolve(repositoryRoot, path)), path).toBe(true);
};

/** The disclosures are catalog copy; the default catalog is the one proven here
 *  (`messages.test.ts` proves the other four carry the same keys). */
const t = createTranslator({ locale: 'en', messages: en as never, onError: () => {} }) as unknown as CopyReader & {
  has(key: string): boolean;
};

const marketedIds = PRODUCT_SECTIONS.flatMap((section) => section.surfaces.map((surface) => surface.id));

describe('public capability proof contract', () => {
  it('requires proof metadata for every marketed product surface and no orphan records', () => {
    expect(new Set(marketedIds).size, 'surface ids are unique').toBe(marketedIds.length);
    expect(Object.keys(PRODUCT_CAPABILITY_PROOF).sort()).toEqual([...marketedIds].sort());
    expect(Object.keys(PRODUCT_CAPABILITY_OPERATIONS).sort()).toEqual([...marketedIds].sort());
  });

  it('does not market planned capabilities as current product surfaces', () => {
    const planned = marketedIds.filter((id) => PRODUCT_CAPABILITY_PROOF[id]?.status === 'planned');
    expect(planned).toEqual([]);
  });

  it('declares boundaries, prerequisites, evidence, and an ISO verification date', () => {
    for (const id of marketedIds) {
      const proof = PRODUCT_CAPABILITY_PROOF[id];
      expect(proof, id).toBeDefined();
      expect(['available', 'beta', 'planned']).toContain(proof.status);
      expect(['browser', 'workspace-cloud', 'connected-service', 'hybrid']).toContain(proof.dataBoundary);
      expect(Array.isArray(proof.prerequisites)).toBe(true);
      for (const prerequisite of proof.prerequisites) expect(t.has(prerequisiteKey(prerequisite)), `${id} prerequisite ${prerequisite}`).toBe(true);
      expect(proof.evidence.length, `${id} evidence`).toBeGreaterThan(0);
      expect(proof.evidence.every((path) => !path.startsWith('http')), `${id} evidence must be repository-owned`).toBe(true);
      expect(proof.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(proof.lastVerified), `${id} verification date`).not.toBeNaN();
      assertEvidenceExists(proof.evidence);
      expect(t(operationsKey(id, 'owner')).length, `${id} owner`).toBeGreaterThan(0);
      expect(t(operationsKey(id, 'limitation')).length, `${id} limitation`).toBeGreaterThan(0);
      expect((t.raw(operationsKey(id, 'exports')) as string[]).length, `${id} exports`).toBeGreaterThan(0);
      expect(PRODUCT_CAPABILITY_OPERATIONS[id].exampleHref, `${id} example`).toMatch(/^\//);
    }
  });

  it('keeps high-risk claims scoped, owned, evidenced, and within review date', () => {
    const forbiddenAbsolute = /\b(always|never|every|entire|zero|100%)\b/i;
    for (const claim of MARKETING_CLAIMS) {
      expect(claim.approvedCopy, claim.id).not.toMatch(forbiddenAbsolute);
      expect(claim.owner.length, claim.id).toBeGreaterThan(0);
      expect(Date.parse(claim.reviewBy), claim.id).toBeGreaterThan(Date.now());
      assertEvidenceExists(claim.evidence);
    }
  });

  it('publishes only named, evidenced integration and workflow proof records', () => {
    expect(INTEGRATION_CAPABILITY_PROOF.length).toBeGreaterThan(0);
    const integrationCopy = t.raw('product.integrationMatrix.items') as { auth: string; limitation: string }[];
    expect(integrationCopy).toHaveLength(INTEGRATION_CAPABILITY_PROOF.length);
    INTEGRATION_CAPABILITY_PROOF.forEach((integration, i) => {
      expect(integration.status).not.toBe('planned');
      expect(integration.dataBoundary).toBe('connected-service');
      expect(integrationCopy[i]?.limitation.length, integration.name).toBeGreaterThan(0);
      assertEvidenceExists([integration.evidence]);
    });
    const workflowLimitations = t.raw('product.workflowLimitations') as string[];
    expect(WORKFLOW_PROOF_DEMOS).toHaveLength(3);
    expect(workflowLimitations).toHaveLength(WORKFLOW_PROOF_DEMOS.length);
    WORKFLOW_PROOF_DEMOS.forEach((demo, i) => {
      expect(workflowLimitations[i]?.length, demo.id).toBeGreaterThan(0);
      assertEvidenceExists(demo.evidence);
    });
  });
});
