import { apiRequest } from './apiClient';
import type { ChatModelSelection, Effort } from '@seanhogg/builderforce-brain-embedded';
import type { CloudOrder } from '@builderforce/model-catalog';

export interface AccountBrainPreferences {
  effort: Effort;
  thinking: boolean;
  webBrowsing: boolean;
  modelSelection: ChatModelSelection;
  responseInstructions: string;
  /** Which cloud funds an unpinned turn (api `fundingOrder.ts`). */
  cloudOrder: CloudOrder;
}

const request = <T>(opts: Parameters<typeof apiRequest>[1] = {}): Promise<T> =>
  apiRequest<T>('/api/account/brain-preferences', opts);

export const accountBrainPreferencesApi = {
  get: (): Promise<{ preferences: AccountBrainPreferences }> => request(),
  /** A PARTIAL save — the server keeps every field the patch omits. */
  update: (preferences: Partial<AccountBrainPreferences>): Promise<{ preferences: AccountBrainPreferences }> =>
    request({ method: 'PUT', body: JSON.stringify(preferences) }),
};
