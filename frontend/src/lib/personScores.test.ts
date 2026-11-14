import { describe, expect, it, vi, afterEach } from 'vitest';

// The client is one apiRequest call — mock the transport, assert the path and the
// returned payload shape. Never hits the network.
vi.mock('@/lib/apiClient', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from './apiClient';
import { getTeamPeopleScores } from './personScores';

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.resetAllMocks());

describe('getTeamPeopleScores', () => {
  it('requests the team people endpoint', async () => {
    apiRequestMock.mockResolvedValue({ teamId: 7, windowDays: 90, humanScoringEnabled: true, people: [] });
    await getTeamPeopleScores(7);
    expect(apiRequestMock).toHaveBeenCalledWith('/api/teams/7/people');
  });

  it('returns the scores payload the route produces', async () => {
    const payload = {
      teamId: 3,
      windowDays: 90,
      humanScoringEnabled: false,
      people: [
        {
          contributorId: 9,
          displayName: 'Ada',
          kind: 'human',
          scores: [{ status: 'insufficient-data', finalRuns: 3 }],
        },
      ],
    };
    apiRequestMock.mockResolvedValue(payload);
    const result = await getTeamPeopleScores(3);
    expect(result.people[0]?.scores[0]?.status).toBe('insufficient-data');
    expect(result.humanScoringEnabled).toBe(false);
  });
});
