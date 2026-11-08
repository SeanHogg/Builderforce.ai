/** Client for `GET /api/people/:userId` - one teammate's profile. */
import { apiRequest } from './apiClient';
import type { PsychometricProfile } from './psychometric';

export interface PersonProfileDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  roles: string[];
  psychometric: PsychometricProfile | null;
  work: { openAssigned: number; recentAssigned: number; completed: number };
}

export const peopleApi = {
  get: (userId: string): Promise<PersonProfileDto> =>
    apiRequest<PersonProfileDto>(`/api/people/${encodeURIComponent(userId)}`),
};
