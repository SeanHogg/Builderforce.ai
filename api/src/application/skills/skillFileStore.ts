/**
 * The bundled files of a skill folder (`skill_files`, migration 1259) — the ONE reader
 * and writer of that table, for both kinds of owner.
 *
 * A skill's SKILL.md body lives on its owning row (`tenant_skills.body`,
 * `marketplace_skills.readme`); everything else in the folder lives here. Every write
 * replaces the folder whole, because a skill folder is versioned as a unit: a partial
 * update that left last version's `scripts/` beside this version's instructions would
 * be a skill nobody authored.
 *
 * Callers hand over files that `@builderforce/agent-skills` has ALREADY read — paths
 * normalised and held inside the folder, sizes within the package limits. This module
 * trusts that and only persists, so the safety rule is enforced in one place.
 *
 * TEXT files live inline in `content`. BINARY assets (`encoding: 'base64'` on the wire:
 * an image, a font, a PDF) live in R2 (the UPLOADS bucket) at `r2_key` (migration 1262),
 * and leave as base64 again on export. Agents never get the bytes: `readSkillFile`
 * answers a binary path with a short description of the asset instead.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { isValidSkillName, toSkillName, writeSkillPackage, type SkillFile, type SkillManifest } from '@builderforce/agent-skills';
import { inTransaction, type Db, type Tx } from '../../infrastructure/database/connection';
import { skillFiles } from '../../infrastructure/database/schema';
import { base64ToBytes, bytesToBase64 } from '../../domain/shared/bytes';
import { contentTypeFor } from '../ide/siteHosting';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';

/** Who owns a file: a workspace skill (uuid) or a marketplace skill (serial id). */
export type SkillOwner = { kind: 'workspace'; id: string } | { kind: 'marketplace'; id: number };

/** One bundled file as a listing shows it — the content is fetched only on demand. */
export interface SkillFileEntry {
  path: string;
  sizeBytes: number;
}

/** The slice of an R2 bucket the store uses; `env.UPLOADS` satisfies it. */
export interface SkillAssetBucket {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
}

/** The bucket binary skill assets live in, or null where none is bound. */
export function skillAssetBucket(env: Env | undefined): SkillAssetBucket | null {
  return (env?.UPLOADS as SkillAssetBucket | undefined) ?? null;
}

/** A folder carries a binary asset but there is nowhere to keep it. */
export class SkillAssetStorageUnavailable extends Error {
  constructor() {
    super('This skill bundles binary assets, and binary storage is not available here.');
  }
}

const hasBinaryFiles = (files: readonly SkillFile[]): boolean => files.some((f) => f.encoding === 'base64');

/**
 * The spec's optional frontmatter as stored in the `manifest` column. `name` and
 * `description` are NOT here: they have columns of their own on the owning row, and
 * one fact lives in one place.
 */
export type SkillManifestRecord = Omit<SkillManifest, 'name' | 'description'>;

/** The record for a manifest, or null when it carries nothing beyond name + description. */
export function manifestRecordOf(manifest: SkillManifest): SkillManifestRecord | null {
  const { name: _name, description: _description, ...rest } = manifest;
  const hasAny = rest.license || rest.compatibility || rest.metadata || rest.allowedTools || Object.keys(rest.extensions).length > 0;
  return hasAny ? rest : null;
}

/** Rebuild the full manifest from a row's columns + its stored record. */
export function manifestFromRecord(name: string, description: string, record: unknown): SkillManifest {
  const r = (record && typeof record === 'object' ? record : {}) as Partial<SkillManifestRecord>;
  return {
    name,
    description,
    ...(typeof r.license === 'string' ? { license: r.license } : {}),
    ...(typeof r.compatibility === 'string' ? { compatibility: r.compatibility } : {}),
    ...(r.metadata && typeof r.metadata === 'object' ? { metadata: r.metadata } : {}),
    ...(Array.isArray(r.allowedTools) ? { allowedTools: r.allowedTools } : {}),
    extensions: r.extensions && typeof r.extensions === 'object' ? r.extensions : {},
  };
}

/**
 * Any stored skill as a spec FOLDER (SKILL.md first) — the ONE way a skill leaves the
 * platform, whichever store it came from. Two rules live here so no exporter can skip
 * them: the name is a valid spec name (a slug published before the rule existed is
 * coerced, or the agent tool it is taken to would reject the folder), and a display
 * title the spec has no field for travels as `metadata.title`.
 */
export function toSkillFolder(skill: {
  name: string;
  title: string;
  description: string;
  body: string;
  manifest: unknown;
  files: readonly SkillFile[];
}): { name: string; files: SkillFile[] } {
  const name = isValidSkillName(skill.name) ? skill.name : toSkillName(skill.name) || 'skill';
  const manifest = manifestFromRecord(name, skill.description || skill.title, skill.manifest);
  if (skill.title && skill.title !== name && !manifest.metadata?.title) {
    manifest.metadata = { ...(manifest.metadata ?? {}), title: skill.title };
  }
  return { name, files: writeSkillPackage({ manifest, body: skill.body, files: [...skill.files] }) };
}

const ownerColumn = (owner: SkillOwner) =>
  owner.kind === 'workspace' ? eq(skillFiles.tenantSkillId, owner.id) : eq(skillFiles.marketplaceSkillId, owner.id);

const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

/** Every file of one skill, content included (binary assets as base64), sorted by path. */
export async function loadSkillFiles(db: Db, bucket: SkillAssetBucket | null, owner: SkillOwner): Promise<SkillFile[]> {
  const rows = await db
    .select({ path: skillFiles.path, content: skillFiles.content, encoding: skillFiles.encoding, r2Key: skillFiles.r2Key })
    .from(skillFiles)
    .where(ownerColumn(owner))
    .orderBy(skillFiles.path);
  const out: SkillFile[] = [];
  for (const row of rows) {
    if (row.encoding !== 'base64') {
      out.push({ path: row.path, content: row.content ?? '' });
      continue;
    }
    const object = bucket && row.r2Key ? await bucket.get(row.r2Key) : null;
    // A missing object is skipped rather than exported empty: an empty "logo.png" is a
    // broken asset, and the folder is still a valid skill without it.
    if (!object) continue;
    out.push({ path: row.path, content: bytesToBase64(new Uint8Array(await object.arrayBuffer())), encoding: 'base64' });
  }
  return out;
}

/**
 * One file for an AGENT, or null when the skill has no file at that path. Text comes back
 * as-is; a binary asset comes back as a one-line description, because bytes in a prompt
 * are noise and the agent only needs to know the asset is there.
 */
export async function readSkillFile(db: Db, owner: SkillOwner, path: string): Promise<string | null> {
  const [row] = await db
    .select({ content: skillFiles.content, encoding: skillFiles.encoding, sizeBytes: skillFiles.sizeBytes })
    .from(skillFiles)
    .where(and(ownerColumn(owner), eq(skillFiles.path, path)))
    .limit(1);
  if (!row) return null;
  if (row.encoding === 'base64') {
    return `Binary asset, ${row.sizeBytes} bytes, ${contentTypeFor(path)}. It ships with the skill folder and cannot be read as text.`;
  }
  return row.content ?? '';
}

/** File listings for one skill — paths and sizes, never content. */
export async function listSkillFileEntries(db: Db, owner: SkillOwner): Promise<SkillFileEntry[]> {
  return db
    .select({ path: skillFiles.path, sizeBytes: skillFiles.sizeBytes })
    .from(skillFiles)
    .where(ownerColumn(owner))
    .orderBy(skillFiles.path);
}

/**
 * File listings for MANY workspace skills in one query — the review queue shows each
 * skill's folder, and a query per row would be the N+1 this exists to avoid.
 */
export async function listWorkspaceSkillFileEntries(db: Db, skillIds: readonly string[]): Promise<Map<string, SkillFileEntry[]>> {
  const out = new Map<string, SkillFileEntry[]>();
  if (skillIds.length === 0) return out;
  const rows = await db
    .select({ owner: skillFiles.tenantSkillId, path: skillFiles.path, sizeBytes: skillFiles.sizeBytes })
    .from(skillFiles)
    .where(inArray(skillFiles.tenantSkillId, [...skillIds]))
    .orderBy(skillFiles.path);
  for (const row of rows) {
    if (!row.owner) continue;
    const list = out.get(row.owner) ?? [];
    list.push({ path: row.path, sizeBytes: row.sizeBytes });
    out.set(row.owner, list);
  }
  return out;
}

/** The R2 keys a skill's binary assets live at — read BEFORE deleting the skill row. */
export async function skillAssetKeys(db: Db | Tx, owner: SkillOwner): Promise<string[]> {
  const rows = await db
    .select({ r2Key: skillFiles.r2Key })
    .from(skillFiles)
    .where(and(ownerColumn(owner), isNotNull(skillFiles.r2Key)));
  return rows.map((r) => r.r2Key).filter((k): k is string => !!k);
}

/**
 * Remove asset objects no row points at any more. Best-effort by design: an orphaned
 * object costs storage, never correctness, so a failure is reported and swallowed.
 */
export async function deleteSkillAssets(bucket: SkillAssetBucket | null, keys: readonly string[], operation: string): Promise<void> {
  if (!bucket || keys.length === 0) return;
  await bucket.delete([...keys]).catch((error: unknown) => {
    reportCaughtError(error, { source: 'application/skills/skillFileStore.ts', operation });
  });
}

/**
 * Save a skill's row AND its whole folder as one unit: `writeOwner` (the row's insert or
 * update) and the file rows commit in ONE transaction, so a failed file write never
 * leaves new instructions beside last version's files.
 *
 * Binary assets go to R2 BEFORE the transaction, under a fresh write id
 * (`skill-files/<scope>/<skillId>/<writeId>/<path>`), so a rollback never leaves the old
 * rows pointing at overwritten bytes: on failure the new objects are deleted, on commit
 * the replaced ones are. `scope` is the tenant id for a workspace skill, `market` for a
 * marketplace listing.
 */
export async function saveSkillFolder<T>(
  db: Db,
  bucket: SkillAssetBucket | null,
  target: { owner: SkillOwner; scope: string },
  files: readonly SkillFile[],
  writeOwner: (tx: Tx) => Promise<T>,
): Promise<T> {
  const { owner, scope } = target;
  if (hasBinaryFiles(files) && !bucket) throw new SkillAssetStorageUnavailable();
  const writeId = crypto.randomUUID().slice(0, 8);
  const uploaded: string[] = [];
  const ownerRef = owner.kind === 'workspace' ? { tenantSkillId: owner.id } : { marketplaceSkillId: owner.id };
  try {
    const rows: (typeof skillFiles.$inferInsert)[] = [];
    for (const f of files) {
      if (f.encoding !== 'base64') {
        rows.push({ ...ownerRef, path: f.path, encoding: 'utf8', content: f.content, r2Key: null, sizeBytes: utf8Length(f.content) });
        continue;
      }
      const bytes = base64ToBytes(f.content);
      const r2Key = `skill-files/${scope}/${owner.id}/${writeId}/${f.path}`;
      await bucket!.put(r2Key, bytes, { httpMetadata: { contentType: contentTypeFor(f.path) } });
      uploaded.push(r2Key);
      rows.push({ ...ownerRef, path: f.path, encoding: 'base64', content: null, r2Key, sizeBytes: bytes.byteLength });
    }

    const { result, replaced } = await inTransaction(db, async (tx) => {
      const written = await writeOwner(tx);
      const previous = await skillAssetKeys(tx, owner);
      await tx.delete(skillFiles).where(ownerColumn(owner));
      if (rows.length > 0) await tx.insert(skillFiles).values(rows);
      return { result: written, replaced: previous };
    });

    await deleteSkillAssets(bucket, replaced, 'saveSkillFolder.deleteReplaced');
    return result;
  } catch (error) {
    await deleteSkillAssets(bucket, uploaded, 'saveSkillFolder.rollbackUploads');
    throw error;
  }
}
