/**
 * Reading ONE applicant out of a list action's item through the manifest's `applicants`
 * mapping — the people-shaped sibling of `mapConnectorResponse`. Pure and vendor-blind:
 * a declaration in, a normalised applicant out.
 *
 * Nothing is invented. An item with no id selector hit is dropped (`null`) because the
 * id is the dedupe key, and a person with no stable id would be re-imported on every
 * run. Name and email are optional: a board that does not deliver them gives a
 * candidate without them rather than a guess.
 */

import type { ConnectorApplicantMapping } from './connectorManifest';
import { firstOf } from './connectorResponseMapping';

export interface MappedApplicant {
  externalId: string;
  /** The board's id for the PERSON, when its manifest gives one. */
  candidateId: string | null;
  name: string | null;
  email: string | null;
  /** Null when the board gave no usable date. */
  appliedAt: Date | null;
}

/** ISO strings, epoch seconds and epoch milliseconds all arrive from real boards. */
export function parseAppliedAt(raw: string | null): Date | null {
  if (!raw) return null;
  const numeric = /^\d{9,14}$/.test(raw) ? Number(raw) : null;
  const date = numeric !== null ? new Date(numeric < 1e11 ? numeric * 1000 : numeric) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function mapApplicant(mapping: ConnectorApplicantMapping, item: unknown): MappedApplicant | null {
  const result = { data: item };
  const externalId = firstOf(result, mapping.externalId);
  if (!externalId) return null;
  const joined = [firstOf(result, mapping.firstName), firstOf(result, mapping.lastName)].filter(Boolean).join(' ');
  const name = firstOf(result, mapping.name) ?? (joined || null);
  const email = firstOf(result, mapping.email)?.toLowerCase() ?? null;
  return {
    externalId: externalId.slice(0, 255),
    candidateId: firstOf(result, mapping.candidateId)?.slice(0, 255) ?? null,
    name: name ? name.slice(0, 200) : null,
    email: email && EMAIL_RE.test(email) ? email : null,
    appliedAt: parseAppliedAt(firstOf(result, mapping.appliedAt)),
  };
}
