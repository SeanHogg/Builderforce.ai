/**
 * Wire adapters for the founder's-journey reads — the Creation Session list and
 * its Realizations, which `useFounderJourney` (the arc position shared by the
 * Journey Strip, the TopBar pill and the canvas chip) and the dashboard's Ideas
 * tab both call.
 *
 * `investorApi.companies.list` deliberately has NO fixture here: an empty list
 * is the honest, correct answer for a visitor who has not raised anything, and
 * it is what puts the journey on Idea rather than Run. Adding a sample company
 * would flip that by accident, so its absence is load-bearing, not a gap.
 */

import { SAMPLE_IDEA_SESSION } from '../../domain/sampleWorkspace';
import { dayOffsetToIso, exact, type GuestFixture } from '../../domain/guestFixture';

export const founderJourneyFixtures: GuestFixture[] = [
  {
    id: 'creationSessions.list',
    match: exact('/api/creation-sessions'),
    respond: ({ now }) => ({
      sessions: [
        {
          id: SAMPLE_IDEA_SESSION.id,
          title: SAMPLE_IDEA_SESSION.title,
          description: SAMPLE_IDEA_SESSION.description,
          folderId: null,
          folderName: null,
          folderProjectId: null,
          status: 'active',
          preview: {
            objectCount: 2,
            kinds: ['chat', 'website'],
            objects: [
              { id: `${SAMPLE_IDEA_SESSION.id}-obj-1`, kind: 'chat', x: 40, y: 60, title: 'Read the idea' },
              { id: `${SAMPLE_IDEA_SESSION.id}-obj-2`, kind: 'website', x: 220, y: 90, title: 'Waitlist page', status: 'live' },
            ],
          },
          revision: 4,
          lastActivityAt: dayOffsetToIso(now, SAMPLE_IDEA_SESSION.lastActivityDayOffset),
          createdAt: dayOffsetToIso(now, SAMPLE_IDEA_SESSION.createdDayOffset),
          role: 'owner',
          pinned: false,
          unread: false,
          collaboratorCount: 1,
          projectIds: [],
          mode: 'work',
        },
      ],
    }),
  },
  {
    id: 'realizations.list',
    match: exact('/api/realizations'),
    respond: ({ now }) => ({
      realizations: SAMPLE_IDEA_SESSION.realizations.map((realization, index) => ({
        id: `${SAMPLE_IDEA_SESSION.id}-realization-${index + 1}`,
        challengeId: null,
        projectId: null,
        sessionId: SAMPLE_IDEA_SESSION.id,
        targetKey: realization.targetKey,
        title: realization.title,
        strategy: 'declarative',
        status: realization.status,
        liveUrl: null,
        spec: {
          title: realization.title,
          sponsor: null,
          goal: SAMPLE_IDEA_SESSION.description,
          capabilities: [],
          integrations: [],
          deliverables: [],
          constraints: [],
          successCriteria: [],
        },
        plan: {
          blueprintKey: realization.targetKey,
          blueprintName: realization.title,
          matchScore: 1,
          matchReasons: [],
          considered: [],
          strategy: 'declarative',
          summary: realization.title,
          files: {},
          handlers: {},
          handlerWarnings: [],
          tasks: [],
          requiredConnectors: [],
          requiredSecrets: [],
          successCriteria: [],
        },
        error: null,
        verdict: realization.verdict,
        verdictMetric: null,
        decidedAt: realization.verdict ? dayOffsetToIso(now, realization.createdDayOffset + 1) : null,
        createdAt: dayOffsetToIso(now, realization.createdDayOffset),
        updatedAt: dayOffsetToIso(now, realization.createdDayOffset),
      })),
    }),
  },
];
