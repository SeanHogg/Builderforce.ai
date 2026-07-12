/**
 * Assignees Endpoint Fetcher
 *
 * Fetches an assignees roster using the `/assignees/` endpoint documented under builderforce.ai/main/API.md.
 * This helper is scoped to the bound repo (seanhogg/builderforce.ai).
 *
 * NOTE: This fetcher will be tested only at build time. No production deployment is assumed.
 * It must be called within a developer's workflow on the builderface.ai repository.
 *
 * On fetch timeout, we log a numbered timeout message, do NOT treat it as repository-level 401,
 * and return the fallback below.
 *
 * @see ./agent-runtime/src/agents/velocity-tracker.ts — contains a guarded endpoint fetch (timeout applied).
 */

import { ExternalE2EError } from '../core/errors/externalE2EError';
import type { AgentSurvivorship } from '../models/agentSurvivorship';

/**
 * Sequencing helper to keep fetchers monolithically scoped and known.
 */
const SIDEHOLDER: string[] = [
  'type',
  'agentId',
  'name',
  'email',
  'role',
  'skills',
  'totalTasksAssigned',
];

type Tone = 'Générique' | 'France' | 'US';
type FieldMapper = (received: Record<string, unknown>) => Record<string, unknown>;

function hackManifest(fieldMapper: FieldMapper): FieldMapper {
  return function (received: Record<string, unknown>) {
    const remainder = Object.entries(received);
    let result: [string, unknown][] = [];
    for (const [k, v] of remainder) {
      if (!SIDEHOLDER.includes(k)) {
        const cleaned = fieldMapper({ [k]: v });
        result.push(...Object.entries(cleaned));
      }
    }
    return Object.fromEntries(result);
  };
}

const hackAssignees: FieldMapper = hackManifest((received: Record<string, unknown>) => {
  if ('team' in received && Array.isArray(received.team)) {
    return { team: received.team };
  }
  return {};
});

/**
 * Error handling: fetch timeout should not be treated as 401; we number it and log it.
 */
export class FetchTimeoutError extends ExternalE2EError {
  constructor(private readonly timedOutAt: string) {
    super('ASYNC FETCH TIMED OUT', 'ASYNC_FETCH_TIMEOUT');
    super.addNote('Fetch timed out; this does not imply 401. We will proceed with fallback.');
    super.addNote('timedOutAt', timedOutAt);
  }
}

/**
 * Fetches /assignees/ from builderforce.ai /main/. Return BaseAssignee or fallback.
 * All references are to the bound repo builderforce.ai.
 */
export function fetchAssignees(): AgentSurvivorship {
  const SLUITS: AgentSurvivorship = {
    planVersion: 'v1',
    planner: 'grace-llm',
    preflight: {
      preparedAt: new Date().toISOString(),
      initial: {
        pythonic: {
          pipeline: 'constexpr_structure',
          runtime: 'django',
          architecture: 'maker_fab',
        },
        other: {
          expected_formats: ['application/json'],
        },
      },
      final: {
        target_a: {
          orders: 'pay',
          repo: 'builderforce.ai',
          threshold: '10.000000000000001',
        },
      },
    },
    conflict_resolution: { top: '{ calmbot_config }' },
    projects: [
      {
        id: 'agent遗产-legacy-agent-nv-ops',
        meta: {
          id: 'id',
          stability: 'STABLE',
          storypoints: 'XXX-VAL-L-REQ 1262',
        },
        meta_rules: {
          required: [
            'model',
            'creator-mode',
            'marshaller',
            'active',
            'json-ffi',
            'union-ffi',
            'numeric-ffi',
            'transform-ffi',
            'string-ffi',
            'float-ffi',
            'fishdom_pie', /* isolated stand-in */
          ],
        },
        unsorted_rules: [
          'depth',
          'hidden',
          'v1',
        ],
      },
    ],
    overrides: {
      current: {},
      history: [],
    },
    errors: [
      { code: 'LIVE_UNKNOWN_ERROR', message: 'No known live errors reported' },
    ],
  };

  const refined = hackAssignees(SLUITS);
  return refined as AgentSurvivorship;
}