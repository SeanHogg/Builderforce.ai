'use client';

/**
 * Connected file storage — the client for `/api/drive`.
 *
 * Deliberately thin: the interesting decisions (which scopes, how a Google-native
 * document is exported, what gets cached) all live on the API, so this is the
 * transport and nothing else. The one thing it DOES own is turning a downloaded
 * response back into a `File`, because that is what lets a file picked out of
 * Drive go through the exact same import engine a dragged-in file does — one
 * reader, one set of object shapes, one place where "we cannot read this" is
 * decided.
 */

import { apiRequest, apiRequestStream } from './apiClient';
import { filenameFromResponse } from './download';

export type DriveProviderName = 'google' | 'microsoft';

export interface DriveProviderStatus {
  name: DriveProviderName;
  label: string;
  /** False when the deployment has no client id/secret for this provider — the
   * button is shown disabled with a reason rather than hidden, so an operator
   * can see what is missing. */
  configured: boolean;
}

export interface DriveConnection {
  id: number;
  provider: DriveProviderName;
  accountEmail: string;
  displayName: string;
  status: 'connected' | 'expired' | 'revoked' | string;
  lastError: string | null;
}

export interface DriveItem {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  mimeType: string;
  sizeBytes?: number;
  modifiedAt?: string;
  parentId?: string;
}

export interface DriveListing {
  items: DriveItem[];
  nextCursor?: string;
}

export const driveApi = {
  /** What this deployment offers, and what the signed-in person has connected. */
  providers: () => apiRequest<{ providers: DriveProviderStatus[]; connections: DriveConnection[] }>('/api/drive/providers'),

  /**
   * The consent URL to navigate to.
   *
   * The API returns it rather than redirecting, because a top-level navigation
   * cannot carry the bearer token — the browser has to make the jump itself
   * after this authenticated fetch.
   */
  connectUrl: (provider: DriveProviderName, returnTo: string) =>
    apiRequest<{ authUrl: string }>(`/api/drive/connect/${provider}?returnTo=${encodeURIComponent(returnTo)}`),

  disconnect: (connectionId: number) =>
    apiRequest<{ ok: true }>(`/api/drive/connections/${connectionId}`, { method: 'DELETE' }),

  /** One folder at a time — a drive is arbitrarily deep, so the tree is walked,
   * never fetched whole. */
  list: (connectionId: number, folderId?: string | null, cursor?: string) => {
    const params = new URLSearchParams({
      ...(folderId ? { folderId } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const query = params.toString();
    return apiRequest<DriveListing>(`/api/drive/connections/${connectionId}/files${query ? `?${query}` : ''}`);
  },

  /**
   * Fetch a file as a `File`, ready for the canvas import engine.
   *
   * The provider's own filename is taken from `Content-Disposition` rather than
   * from the item we listed, because a Google-native document is EXPORTED and
   * comes back with a different extension than it had in Drive — a Google Doc
   * arrives as `.docx`, which is precisely what makes it land on the board as an
   * editable document instead of an opaque attachment.
   */
  async fetchFile(connectionId: number, item: DriveItem): Promise<File> {
    const res = await apiRequestStream(`/api/drive/connections/${connectionId}/files/${encodeURIComponent(item.id)}`, {
      expectedErrors: [400, 401, 413, 415, 503],
    });
    if (!res.ok) {
      const failure = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(failure.error || `Could not open ${item.name}`);
    }
    const blob = await res.blob();
    const name = filenameFromResponse(res, item.name);
    return new File([blob], name, { type: blob.type || item.mimeType });
  },
};
