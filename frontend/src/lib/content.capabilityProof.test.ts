import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_CAPABILITY_PROOF,
  MARKETING_CLAIMS,
  PRODUCT_CAPABILITY_PROOF,
  PRODUCT_CAPABILITY_OPERATIONS,
  PRODUCT_SECTIONS,
  WORKFLOW_PROOF_DEMOS,
} from './content';

const repositoryRoot = resolve(process.cwd(), '..');
const assertEvidenceExists = (paths: readonly string[]) => {
  for (const path of paths) expect(existsSync(resolve(repositoryRoot, path)), path).toBe(true);
};

const marketedTitles = PRODUCT_SECTIONS.flatMap((section) =>
  section.surfaces.map((surface) => surface.title),
);

describe('public capability proof contract', () => {
  it('requires proof metadata for every marketed product surface and no orphan records', () => {
    expect(Object.keys(PRODUCT_CAPABILITY_PROOF).sort()).toEqual([...marketedTitles].sort());
    expect(Object.keys(PRODUCT_CAPABILITY_OPERATIONS).sort()).toEqual([...marketedTitles].sort());
  });

  it('does not market planned capabilities as current product surfaces', () => {
    const planned = marketedTitles.filter((title) => PRODUCT_CAPABILITY_PROOF[title]?.status === 'planned');
    expect(planned).toEqual([]);
  });

  it('declares boundaries, prerequisites, evidence, and an ISO verification date', () => {
    for (const title of marketedTitles) {
      const proof = PRODUCT_CAPABILITY_PROOF[title];
      expect(proof, title).toBeDefined();
      expect(['available', 'beta', 'planned']).toContain(proof.status);
      expect(['browser', 'workspace-cloud', 'connected-service', 'hybrid']).toContain(proof.dataBoundary);
      expect(Array.isArray(proof.prerequisites)).toBe(true);
      expect(proof.evidence.length, `${title} evidence`).toBeGreaterThan(0);
      expect(proof.evidence.every((path) => !path.startsWith('http')), `${title} evidence must be repository-owned`).toBe(true);
      expect(proof.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(proof.lastVerified), `${title} verification date`).not.toBeNaN();
      assertEvidenceExists(proof.evidence);
      const operations = PRODUCT_CAPABILITY_OPERATIONS[title];
      expect(operations.owner.length, `${title} owner`).toBeGreaterThan(0);
      expect(operations.limitation.length, `${title} limitation`).toBeGreaterThan(0);
      expect(operations.exports.length, `${title} exports`).toBeGreaterThan(0);
      expect(operations.exampleHref, `${title} example`).toMatch(/^\//);
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
    for (const integration of INTEGRATION_CAPABILITY_PROOF) {
      expect(integration.status).not.toBe('planned');
      expect(integration.dataBoundary).toBe('connected-service');
      expect(integration.limitation.length).toBeGreaterThan(0);
      assertEvidenceExists([integration.evidence]);
    }
    expect(WORKFLOW_PROOF_DEMOS).toHaveLength(3);
    for (const demo of WORKFLOW_PROOF_DEMOS) {
      expect(demo.limitation.length).toBeGreaterThan(0);
      assertEvidenceExists(demo.evidence);
    }
  });
});
