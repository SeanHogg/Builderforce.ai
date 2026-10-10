import { apiRequest } from './apiClient';

export interface YouTubeConnection { id: number; accountEmail: string; displayName: string; status: string; lastError: string | null }
export interface YouTubePublishInput { connectionId: number; storageKey: string; title: string; description: string; privacyStatus: 'private' | 'unlisted' | 'public'; mimeType: string }

/**
 * One resumable upload, as the server's job reports it. `percent` is what YouTube has
 * CONFIRMED receiving. A short render comes back `succeeded` from the publish call
 * itself; a long one comes back `uploading` and is driven by {@link youtubeApi.advance}.
 */
export interface YouTubeUpload {
  id: string;
  state: 'queued' | 'uploading' | 'succeeded' | 'failed';
  percent: number;
  bytesSent: number;
  byteSize: number;
  videoId: string | null;
  url: string | null;
  privacyStatus: string;
  error: string | null;
}

export const youtubeApi = {
  connections: () => apiRequest<{ configured: boolean; connections: YouTubeConnection[] }>('/api/youtube/connections'),
  connectUrl: (returnTo: string) => apiRequest<{ authUrl: string }>(`/api/youtube/connect?returnTo=${encodeURIComponent(returnTo)}`),
  disconnect: (id: number) => apiRequest<{ ok: true }>(`/api/youtube/connections/${id}`, { method: 'DELETE' }),
  publish: (input: YouTubePublishInput) => apiRequest<YouTubeUpload>('/api/youtube/publish', { method: 'POST', body: JSON.stringify(input), expectedErrors: [400, 401, 404, 502, 503] }),
  /** Run one more chunk tick now (a no-op while another tick holds it) and report where it stands. */
  advance: (uploadId: string) => apiRequest<{ upload: YouTubeUpload }>(`/api/youtube/uploads/${encodeURIComponent(uploadId)}/advance`, { method: 'POST', expectedErrors: [404] }),
};
