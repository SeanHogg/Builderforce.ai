import { apiRequest } from './apiClient';

export interface PublicCanvasResume {
  objectId: string;
  title: string;
  resumeFamily: Record<string, unknown>;
}

export const publicResumesApi = {
  get: (token: string) => apiRequest<{ resume: PublicCanvasResume }>(`/api/public/resumes/${encodeURIComponent(token)}`, { auth: 'none' }),
};
