import { apiRequest } from './apiClient';

/**
 * THE client for a project's media library — `/api/projects/:id/media`. The
 * record of the images and clips generated for a project (generation itself is
 * `imageGenerationApi` / `videoGenerationApi`). Studio's Media panel is the
 * one consumer; it records what it generates and reads the library back.
 */

export type ProjectMediaKind = 'image' | 'video';
export type ProjectMediaStatus = 'rendering' | 'ready' | 'failed';

export interface ProjectMediaItem {
  id: string;
  kind: ProjectMediaKind;
  status: ProjectMediaStatus;
  prompt: string;
  url: string | null;
  storageKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  model: string | null;
  jobId: string | null;
  error: string | null;
  usedAt: string | null;
  createdAt: string;
}

export type NewProjectMedia = Pick<ProjectMediaItem, 'kind' | 'status' | 'prompt'>
  & Partial<Pick<ProjectMediaItem, 'url' | 'storageKey' | 'mimeType' | 'width' | 'height' | 'durationSeconds' | 'model' | 'jobId'>>;

export type ProjectMediaPatch = Partial<Pick<ProjectMediaItem, 'status' | 'url' | 'storageKey' | 'mimeType' | 'durationSeconds' | 'model' | 'jobId' | 'error'>> & { used?: boolean };

const base = (projectId: number) => `/api/projects/${projectId}/media`;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const projectMediaApi = {
  async list(projectId: number): Promise<ProjectMediaItem[]> {
    return (await apiRequest<{ media: ProjectMediaItem[] }>(base(projectId))).media;
  },
  async record(projectId: number, media: NewProjectMedia): Promise<ProjectMediaItem> {
    return (await apiRequest<{ media: ProjectMediaItem }>(base(projectId), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(media) })).media;
  },
  async update(projectId: number, mediaId: string, patch: ProjectMediaPatch): Promise<ProjectMediaItem> {
    return (await apiRequest<{ media: ProjectMediaItem }>(`${base(projectId)}/${encodeURIComponent(mediaId)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })).media;
  },
  async remove(projectId: number, mediaId: string): Promise<void> {
    await apiRequest(`${base(projectId)}/${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
  },
};
