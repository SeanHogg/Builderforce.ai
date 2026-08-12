import { apiRequest } from './apiClient';

export interface YouTubeConnection { id: number; accountEmail: string; displayName: string; status: string; lastError: string | null }
export interface YouTubePublishInput { connectionId: number; storageKey: string; title: string; description: string; privacyStatus: 'private' | 'unlisted' | 'public'; mimeType: string }

export const youtubeApi = {
  connections: () => apiRequest<{ configured: boolean; connections: YouTubeConnection[] }>('/api/youtube/connections'),
  connectUrl: (returnTo: string) => apiRequest<{ authUrl: string }>(`/api/youtube/connect?returnTo=${encodeURIComponent(returnTo)}`),
  disconnect: (id: number) => apiRequest<{ ok: true }>(`/api/youtube/connections/${id}`, { method: 'DELETE' }),
  publish: (input: YouTubePublishInput) => apiRequest<{ videoId: string; url: string; privacyStatus: string }>('/api/youtube/publish', { method: 'POST', body: JSON.stringify(input), expectedErrors: [400, 401, 502, 503] }),
};
