/**
 * Person-scores API client — /api/teams/:id/people (PRD 41 §D14, WS22).
 *
 * The People view on the team page reads per-contributor, per-role quality scores
 * from this one endpoint. The types mirror the route's response; the server enforces
 * mayViewPersonScore and audits every view of another person's score.
 */
import { apiRequest } from './apiClient';

/** One scored measure (a D14.2 rate, standardized and shrunk). */
export interface ScoredMeasure {
  id: string;
  observed: number;
  expected: number;
  finalRuns: number;
  standardizedRatio: number | null;
  posteriorMean: number | null;
  posteriorInterval: [number, number] | null;
  funnelInterval: [number, number] | null;
  outsideLimits: boolean;
}

/** A per-role score: ok (with measures) or insufficient-data below the 20-run minimum. */
export type PersonScore =
  | { status: 'insufficient-data'; finalRuns: number }
  | { status: 'ok'; finalRuns: number; measures: ScoredMeasure[] };

export interface PersonScoreEntry {
  contributorId: number;
  displayName: string;
  kind: string; // 'human' | 'agent'
  scores: PersonScore[];
}

export interface TeamPeopleScores {
  teamId: number;
  windowDays: number;
  humanScoringEnabled: boolean;
  people: PersonScoreEntry[];
}

/** GET /api/teams/:id/people — the team's People view. 404 when the team is unknown or
 *  the tenant's human scoring is off (and there is no agent score to show). */
export async function getTeamPeopleScores(teamId: number): Promise<TeamPeopleScores> {
  return apiRequest<TeamPeopleScores>(`/api/teams/${teamId}/people`);
}
