import { apiRequest } from './apiClient';
import type { ChatModelSelection, Effort } from '@seanhogg/builderforce-brain-embedded';

export interface AccountBrainPreferences {
  effort: Effort;
  thinking: boolean;
  webBrowsing: boolean;
  modelSelection: ChatModelSelection;
  responseInstructions: string;
}

const request = <T>(opts: Parameters<typeof apiRequest>[1] = {}): Promise<T> =>
  apiRequest<T>('/api/account/brain-preferences', { ...opts, auth: 'web' });

export const accountBrainPreferencesApi = {
  get: (): Promise<{ preferences: AccountBrainPreferences }> => request(),
  update: (preferences: AccountBrainPreferences): Promise<{ preferences: AccountBrainPreferences }> =>
    request({ method: 'PUT', body: JSON.stringify(preferences) }),
};
