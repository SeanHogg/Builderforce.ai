/**
 * Built-in connectors — job distribution and applicant sources.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────────
 * The canvas gained a `jobPosting` object and the hiring domain already had
 * `job_items` and `job_websites`, and there was no way to PUBLISH a requisition
 * anywhere: `defaults/` shipped communication, twilio, business, productivity,
 * devtools, generic and social, and nothing that puts a role in front of a candidate.
 * So "post this role" — the action that starts every search — terminated in a document,
 * `job_applications` had no producer, and applicant volume was zero by construction.
 *
 * ── OUTBOUND, NOT INBOUND ────────────────────────────────────────────────────────
 * Deliberately distinct from the HRMS/ATS READER the register asks for separately: that
 * one reads a customer's existing Greenhouse or Workday roster, this one WRITES a
 * posting outward and reads back the applications it produced. A tenant will commonly
 * have both, pointed at different systems, and collapsing them would make "where do our
 * applications come from" unanswerable.
 *
 * ── WHY THESE ARE MANIFESTS AND NOT CODE ─────────────────────────────────────────
 * Migration 0410 made a connector DATA. Adding Otta, Welcome to the Jungle or a
 * country-specific board is a file in `hiring/` — reviewed like data, validated by
 * the same `parseConnectorManifest` gate tenant-authored connectors pass, and shipped
 * without a new code path. Every call is credentialled per tenant and audited, because
 * it goes through `connectorTools.ts` like every other connector call.
 *
 * ── THE FEED CONNECTOR IS THE IMPORTANT ONE ──────────────────────────────────────
 * `job-feed` has no vendor at all: it publishes the tenant's own postings as an
 * indexable XML/JSON feed at a URL, which is how every aggregator that has no partner
 * API ingests roles. It is the connector that works for the boards not listed here, and
 * it is why this family is not a race to enumerate vendors.
 *
 * This file is only the index: one manifest per file under `hiring/`, in the order the
 * catalog lists them.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { ashbyPostings } from './hiring/ashby';
import { greenhouseJobBoard } from './hiring/greenhouse';
import { indeedSponsored } from './hiring/indeed';
import { jobFeed } from './hiring/jobFeed';
import { leverPostings } from './hiring/lever';
import { linkedinJobs } from './hiring/linkedin';
import { workable } from './hiring/workable';

export const HIRING_CONNECTORS: readonly ConnectorManifest[] = [
  jobFeed,
  greenhouseJobBoard,
  leverPostings,
  ashbyPostings,
  indeedSponsored,
  linkedinJobs,
  workable,
];
