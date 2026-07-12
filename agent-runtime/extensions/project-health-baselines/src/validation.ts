/**
 * Baseline Validation Rules
 *
 * Enforces immutability of baseline content and metadata according to AC-1 through AC-2.
 */

import type { Baseline } from './types.js';

/**
 * Max length before truncation (tokens ≈ chars/4 for approximating limit).
 * PRD: Interventions limited to up to 10,000 tokens.
 */
export const MAX_TOKEN_COUNT = 10000;
export const MAX_CHARACTERS = MAX_TOKEN_COUNT * 4; // Approximate 10k tokens

/**
 * Validation errors with human-readable messages.
 */
export class BaselineValidationError extends Error {
  /** Tag to group related errors (for UI) */
  public readonly category: string;

  constructor(message: string, category = 'validation') {
    super(message);
    this.name = 'BaselineValidationError';
    this.category = category;
  }
}

/**
 * Normalize text into an array of paragraphs.
 * A paragraph is a contiguous sequence ending with one or more trailing newlines.
 */
export function splitIntoParagraphs(text: string): string[] {
  if (!text || text.trim().length === 0) return [];
  // Trim leading/trailing whitespace, then split on two or more consecutive newlines
  const trimmed = text.trim();
  return trimmed
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0);
}

/**
 * Validate that a response candidate is within token limits.
 * AC-1: responseText must not exceed token limit.
 */
export function validateResponseLength(text: string): void {
  // Fast path for obvious excess
  if (text.length > MAX_CHARACTERS * 2) {
    throw new BaselineValidationError(
      `Response exceeds safety limits: ${text.length} characters > ${MAX_CHARACTERS * 2}`,
      'size'
    );
  }

  // Count char groups as a token approximation to avoid heavy leanings or regex engines
  const approxTokens = Math.ceil(text.length / 4);
  if (approxTokens > MAX_TOKEN_COUNT) {
    throw new BaselineValidationError(
      `Response exceeds PRD limit: ~${approxTokens.toLocaleString()} tokens > ${MAX_TOKEN_COUNT.toLocaleString()}`,
      'size'
    );
  }
}

/**
 * Validate immutability of core content fields.
 * AC-2: Ensure baseline content cannot be modified after creation.
 */
export function validateImmutableFields(existing: Baseline, changes: Pick<Baseline, 'content'>): void {
  if (!changes.content) return;

  if (changes.content.responseText !== existing.content.responseText) {
    throw new BaselineValidationError(
      'Content immutability: responseText cannot be modified after baseline creation',
      'content'
    );
  }

  // The prompt version that generated the content should not change.
  // Metadata model fields considered core and immutable:
  const existingCoreMeta = existing.content.responseMetadata;
  const changedMeta = changes.content.responseMetadata;

  const isModelChanged = existingCoreMeta.model !== changedMeta.model;

  const isTimestampModified = existingCoreMeta.timestamp !== changedMeta.timestamp;

  // contextMode is also core in the minimal model; we omit it if undefined
  const isContextModeModified =
    existingCoreMeta.contextMode !== undefined
      ? existingCoreMeta.contextMode !== changedMeta.contextMode
      : existingCoreMeta.contextMode === undefined
      ? changedMeta.contextMode !== undefined
      : false;

  if (isModelChanged || isTimestampModified || isContextModeModified) {
    // Provide a helpful message indicating which fields are immutable so frontend can disable editing
    const immutableFields: string[] = [];

    if (existingCoreMeta.model !== changedMeta.model) immutableFields.push('model');

    if (existingCoreMeta.timestamp !== changedMeta.timestamp) immutableFields.push('timestamp');

    if (existingCoreMeta.contextMode !== undefined) {
      if (existingCoreMeta.contextMode !== changedMeta.contextMode) {
        immutableFields.push('contextMode');
      }
    } else if (existingCoreMeta.contextMode === undefined && changedMeta.contextMode !== undefined) {
      immutableFields.push('contextMode');
    }

    throw new BaselineValidationError(
      `Content immutability: ${immutableFields.join(', ')} cannot be modified after baseline creation`,
      'content'
    );
  }
}

/**
 * Validate move_to. If server moves the baseline to owner2: update owner to owner2, updatedAt, and audit.
 */
export function validateOwnerModel(body: unknown) {
  const parsed = body
    ? typeof body === 'object' && body !== null
    : false;
  if (!parsed) {
    throw new BaselineValidationError('owner must be a non-null object', 'owner');
  }

  const owner = (body as Record<string, unknown>).owner;
  const ownerIdParsed = typeof owner === 'string' && owner.trim().length > 0;
  if (!ownerIdParsed) {
    throw new BaselineValidationError('owner.ownerId must be provided and non-empty string', 'owner');
  }

  const ownerNameParsed =
    typeof (body as Record<string, unknown>).ownerName === 'string' &&
    (body as Record<string, unknown>).ownerName.trim().length > 0;
  if (!ownerNameParsed) {
    throw new BaselineValidationError('owner.ownerName must be provided and non-empty string', 'owner');
  }

  if (typeof (body as Record<string, unknown>).projectId !== 'number') {
    throw new BaselineValidationError('projectId must be a number', 'project');
  }

  const updatedAtParsed =
    typeof (body as Record<string, unknown>).updatedAt === 'string' &&
    (body as Record<string, unknown>).updatedAt.trim().length > 0;
  if (!updatedAtParsed) {
    throw new BaselineValidationError('updatedAt must be a non-empty string', 'update');
  }
}