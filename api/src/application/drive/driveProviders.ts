/**
 * Google Drive and OneDrive behind ONE file-storage port.
 *
 * The canvas asks two questions of a connected drive — "what is in this folder"
 * and "give me the bytes of this file" — and both vendors answer them with
 * different nouns: Drive has `files.list` with a parent query and a separate
 * EXPORT endpoint for its own native formats, Graph has `driveItem` children and
 * a single `/content`. Normalizing here is what lets the panel, the tree and the
 * canvas import be written once, exactly as `mailboxProviders` does for mail.
 *
 * A Google-native document is the wrinkle worth naming: a Google Doc has no
 * bytes to download at all. It must be EXPORTED, and the format we ask for is
 * the Office container the canvas already knows how to read — so a Google Doc
 * arrives on the board as a `.docx` and goes straight through `officeFormats`
 * with no special case anywhere downstream.
 */

/** Everything the tree and the importer need about one item. */
export interface DriveItem {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  mimeType: string;
  sizeBytes?: number;
  modifiedAt?: string;
  /** Set for items reached by listing a folder, so a client can build a path. */
  parentId?: string;
}

export interface DriveListing {
  items: DriveItem[];
  /** Opaque provider cursor; absent when the folder has been fully listed. */
  nextCursor?: string;
}

export interface DriveDownload {
  bytes: ArrayBuffer;
  fileName: string;
  mimeType: string;
}

export type DriveProviderName = 'google' | 'microsoft';

export interface DriveProvider {
  name: DriveProviderName;
  label: string;
  authUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  clientIdKey: 'GOOGLE_CLIENT_ID' | 'MICROSOFT_CLIENT_ID';
  clientSecretKey: 'GOOGLE_CLIENT_SECRET' | 'MICROSOFT_CLIENT_SECRET';
  extraAuthParams?: Record<string, string>;
  accountInfo(accessToken: string): Promise<{ email: string; displayName: string }>;
  /** `folderId` null means the drive's root. */
  list(accessToken: string, folderId: string | null, cursor?: string): Promise<DriveListing>;
  download(accessToken: string, fileId: string): Promise<DriveDownload>;
}

/** A provider said no. Carries the status so the caller can tell "reconnect"
 * (401) from "that folder is gone" (404) from "try again" (5xx). */
export class DriveProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DriveProviderError';
  }
}

/**
 * The ceiling on a single download, matched to the canvas's own parse ceiling
 * (`MAX_PARSEABLE_BYTES`, 48MB). Fetching bytes the board will then refuse to
 * read wastes the round trip and the Worker's memory both.
 */
export const MAX_DRIVE_DOWNLOAD_BYTES = 48 * 1024 * 1024;

/** How many items one folder listing returns. Folders are paged, never
 * truncated silently — the cursor is returned so the caller can ask for more. */
export const DRIVE_PAGE_SIZE = 200;

async function callJson<T>(url: string, accessToken: string, label: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new DriveProviderError(`${label} failed: ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

async function readBytes(res: Response, fileName: string, mimeType: string, label: string): Promise<DriveDownload> {
  if (!res.ok) throw new DriveProviderError(`${label} failed: ${res.status}`, res.status);
  // `content-length` is advisory — a chunked response has none — so the buffer is
  // checked after the read as well. The header check just avoids the transfer.
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_DRIVE_DOWNLOAD_BYTES) {
    throw new DriveProviderError('That file is too large to open on the canvas.', 413);
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_DRIVE_DOWNLOAD_BYTES) {
    throw new DriveProviderError('That file is too large to open on the canvas.', 413);
  }
  return { bytes, fileName, mimeType: res.headers.get('content-type')?.split(';')[0]?.trim() || mimeType };
}

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------

const GOOGLE_API = 'https://www.googleapis.com/drive/v3';

/**
 * What a Google-native file becomes when exported.
 *
 * Deliberately the Office containers rather than PDF: the canvas reads .docx,
 * .xlsx and .pptx into editable objects, and a PDF would arrive as flat text
 * that cannot be edited. A Google Doc should land on the board as a document you
 * can write in, which means it has to arrive as Word.
 */
const GOOGLE_EXPORTS: Readonly<Record<string, { mimeType: string; extension: string }>> = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: 'pptx',
  },
  'application/vnd.google-apps.drawing': { mimeType: 'image/svg+xml', extension: 'svg' },
  'application/vnd.google-apps.script': { mimeType: 'application/json', extension: 'json' },
};

const GOOGLE_FOLDER = 'application/vnd.google-apps.folder';

interface GoogleFile {
  id: string; name: string; mimeType: string; size?: string; modifiedTime?: string;
}

/** Escape a value for Drive's query language, where `'` delimits strings. */
function googleQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export const googleDrive: DriveProvider = {
  name: 'google',
  label: 'Google Drive',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  // `drive.readonly` is the narrowest scope that can both list and export. We
  // never write back, so nothing broader is justified.
  scopes: [
    'openid', 'email', 'profile',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
  clientIdKey: 'GOOGLE_CLIENT_ID',
  clientSecretKey: 'GOOGLE_CLIENT_SECRET',
  // Without `access_type=offline` Google returns no refresh token, and the
  // connection would die at the first hour. `prompt=consent` forces it to be
  // re-issued for a user who has already granted once.
  extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },

  async accountInfo(accessToken) {
    const me = await callJson<{ email?: string; name?: string }>(
      'https://www.googleapis.com/oauth2/v2/userinfo', accessToken, 'Google account lookup',
    );
    return { email: me.email ?? '', displayName: me.name ?? '' };
  },

  async list(accessToken, folderId, cursor) {
    const query = `'${googleQueryValue(folderId || 'root')}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      pageSize: String(DRIVE_PAGE_SIZE),
      // Folders first, then alphabetical — the order a person expects a
      // directory in, done by the provider so paging stays consistent.
      orderBy: 'folder, name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(cursor ? { pageToken: cursor } : {}),
    });
    const body = await callJson<{ files?: GoogleFile[]; nextPageToken?: string }>(
      `${GOOGLE_API}/files?${params}`, accessToken, 'Google Drive listing',
    );
    return {
      items: (body.files ?? []).map((file) => ({
        id: file.id,
        name: file.name,
        kind: file.mimeType === GOOGLE_FOLDER ? 'folder' as const : 'file' as const,
        mimeType: file.mimeType,
        ...(file.size ? { sizeBytes: Number(file.size) } : {}),
        ...(file.modifiedTime ? { modifiedAt: file.modifiedTime } : {}),
        ...(folderId ? { parentId: folderId } : {}),
      })),
      ...(body.nextPageToken ? { nextCursor: body.nextPageToken } : {}),
    };
  },

  async download(accessToken, fileId) {
    const meta = await callJson<GoogleFile>(
      `${GOOGLE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size&supportsAllDrives=true`,
      accessToken, 'Google Drive file',
    );
    const exported = GOOGLE_EXPORTS[meta.mimeType];
    if (exported) {
      // A Google-native file has no bytes of its own; ask for the Office
      // container so it lands on the canvas as something editable.
      const params = new URLSearchParams({ mimeType: exported.mimeType });
      const res = await fetch(`${GOOGLE_API}/files/${encodeURIComponent(fileId)}/export?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const name = meta.name.toLowerCase().endsWith(`.${exported.extension}`) ? meta.name : `${meta.name}.${exported.extension}`;
      return readBytes(res, name, exported.mimeType, 'Google Drive export');
    }
    if (meta.mimeType.startsWith('application/vnd.google-apps.')) {
      throw new DriveProviderError('That Google file has no downloadable form.', 415);
    }
    const res = await fetch(`${GOOGLE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return readBytes(res, meta.name, meta.mimeType, 'Google Drive download');
  },
};

// ---------------------------------------------------------------------------
// OneDrive / SharePoint (Microsoft Graph)
// ---------------------------------------------------------------------------

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { id?: string };
}

export const microsoftDrive: DriveProvider = {
  name: 'microsoft',
  label: 'OneDrive',
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  // `offline_access` is what yields a refresh token on Graph; `Files.Read` is
  // read-only across the signed-in user's own drive.
  scopes: ['offline_access', 'openid', 'email', 'profile', 'User.Read', 'Files.Read'],
  clientIdKey: 'MICROSOFT_CLIENT_ID',
  clientSecretKey: 'MICROSOFT_CLIENT_SECRET',

  async accountInfo(accessToken) {
    const me = await callJson<{ mail?: string; userPrincipalName?: string; displayName?: string }>(
      `${GRAPH_API}/me`, accessToken, 'Microsoft account lookup',
    );
    return { email: me.mail ?? me.userPrincipalName ?? '', displayName: me.displayName ?? '' };
  },

  async list(accessToken, folderId, cursor) {
    // Graph hands back a fully-formed `@odata.nextLink`; following it verbatim is
    // both correct and cheaper than rebuilding the query with a skip token.
    const params = new URLSearchParams({
      $select: 'id,name,size,lastModifiedDateTime,folder,file,parentReference',
      $top: String(DRIVE_PAGE_SIZE),
      $orderby: 'folder,name',
    });
    const url = cursor ?? (folderId
      ? `${GRAPH_API}/me/drive/items/${encodeURIComponent(folderId)}/children?${params}`
      : `${GRAPH_API}/me/drive/root/children?${params}`);
    const body = await callJson<{ value?: GraphItem[]; '@odata.nextLink'?: string }>(
      url, accessToken, 'OneDrive listing',
    );
    return {
      items: (body.value ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.folder ? 'folder' as const : 'file' as const,
        mimeType: item.file?.mimeType ?? (item.folder ? 'inode/directory' : 'application/octet-stream'),
        ...(typeof item.size === 'number' ? { sizeBytes: item.size } : {}),
        ...(item.lastModifiedDateTime ? { modifiedAt: item.lastModifiedDateTime } : {}),
        ...(item.parentReference?.id ? { parentId: item.parentReference.id } : {}),
      })),
      ...(body['@odata.nextLink'] ? { nextCursor: body['@odata.nextLink'] } : {}),
    };
  },

  async download(accessToken, fileId) {
    const meta = await callJson<GraphItem>(
      `${GRAPH_API}/me/drive/items/${encodeURIComponent(fileId)}?$select=id,name,size,file`,
      accessToken, 'OneDrive file',
    );
    if (typeof meta.size === 'number' && meta.size > MAX_DRIVE_DOWNLOAD_BYTES) {
      throw new DriveProviderError('That file is too large to open on the canvas.', 413);
    }
    const res = await fetch(`${GRAPH_API}/me/drive/items/${encodeURIComponent(fileId)}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'follow',
    });
    return readBytes(res, meta.name, meta.file?.mimeType ?? 'application/octet-stream', 'OneDrive download');
  },
};

const PROVIDERS: readonly DriveProvider[] = [googleDrive, microsoftDrive];

export function getDriveProvider(name: string): DriveProvider | null {
  return PROVIDERS.find((provider) => provider.name === name) ?? null;
}

/**
 * What this deployment can offer.
 *
 * `configured` is the honest answer to "can I click this": a provider whose
 * client id and secret are not set on the Worker cannot complete a consent
 * round trip, and offering the button anyway ends in an opaque provider error
 * page rather than a connection.
 */
export function availableDriveProviders(
  env: Record<string, unknown>,
): Array<{ name: DriveProviderName; label: string; configured: boolean }> {
  return PROVIDERS.map((provider) => ({
    name: provider.name,
    label: provider.label,
    configured: isProviderOAuthConfigured(env, provider),
  }));
}
