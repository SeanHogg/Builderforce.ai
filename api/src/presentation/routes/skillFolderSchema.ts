/**
 * An Agent Skills folder on the wire — the ONE request schema for every route that takes
 * one (workspace import, marketplace create and update). A flat file list: a picked
 * directory, an unzipped .zip, or one SKILL.md.
 *
 * Text files carry `content` as-is; a binary asset (an image, a font, a PDF) carries it
 * as base64 with `encoding: 'base64'`, so its cap is the binary limit's base64 length.
 * This schema only bounds the REQUEST; the spec checks — names, paths, decoded sizes,
 * the package total — run in the application layer through `@builderforce/agent-skills`,
 * which is what decides whether the folder is a valid skill.
 */
import { z } from 'zod';
import { DEFAULT_SKILL_PACKAGE_LIMITS, SKILL_BINARY_FILE_MAX_BYTES } from '@builderforce/agent-skills';

/** Base64 length of the largest binary asset the package accepts. */
const BASE64_MAX_CHARS = Math.ceil((SKILL_BINARY_FILE_MAX_BYTES * 4) / 3) + 4;

const SkillFolderFile = z.union([
  z.object({
    path: z.string().min(1).max(512),
    content: z.string().max(DEFAULT_SKILL_PACKAGE_LIMITS.maxFileBytes),
    encoding: z.literal('utf8').optional(),
  }),
  z.object({
    path: z.string().min(1).max(512),
    content: z.string().max(BASE64_MAX_CHARS),
    encoding: z.literal('base64'),
  }),
]);

export const SkillFolderFiles = z.array(SkillFolderFile).min(1).max(DEFAULT_SKILL_PACKAGE_LIMITS.maxFiles);
