import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { userBrainPreferences } from '../../infrastructure/database/schema';
import type { UserId } from '../../domain/shared/types';

export const BRAIN_EFFORTS = ['quick', 'balanced', 'thorough'] as const;
export const BRAIN_MODEL_MODES = ['auto', 'byo_pool', 'model'] as const;
export type AccountBrainEffort = (typeof BRAIN_EFFORTS)[number];
export type AccountBrainModelMode = (typeof BRAIN_MODEL_MODES)[number];

export interface AccountBrainPreferences {
  effort: AccountBrainEffort;
  thinking: boolean;
  webBrowsing: boolean;
  modelSelection: { mode: 'auto' | 'byo_pool' } | { mode: 'model'; model: string };
  responseInstructions: string;
}

export const DEFAULT_ACCOUNT_BRAIN_PREFERENCES: AccountBrainPreferences = {
  effort: 'balanced',
  thinking: false,
  webBrowsing: false,
  modelSelection: { mode: 'auto' },
  responseInstructions: '',
};

interface PreferenceRow {
  effort: string;
  thinking: boolean;
  webBrowsing: boolean;
  modelMode: string;
  modelId: string | null;
  responseInstructions: string | null;
}

function fromRow(row: PreferenceRow | undefined): AccountBrainPreferences {
  if (!row) return DEFAULT_ACCOUNT_BRAIN_PREFERENCES;
  const effort = BRAIN_EFFORTS.includes(row.effort as AccountBrainEffort)
    ? row.effort as AccountBrainEffort
    : 'balanced';
  const modelSelection = row.modelMode === 'model' && row.modelId
    ? { mode: 'model' as const, model: row.modelId }
    : row.modelMode === 'byo_pool'
      ? { mode: 'byo_pool' as const }
      : { mode: 'auto' as const };
  return {
    effort,
    thinking: row.thinking,
    webBrowsing: row.webBrowsing,
    modelSelection,
    responseInstructions: row.responseInstructions ?? '',
  };
}

export async function getAccountBrainPreferences(db: Db, userId: UserId): Promise<AccountBrainPreferences> {
  const [row] = await db.select({
    effort: userBrainPreferences.effort,
    thinking: userBrainPreferences.thinking,
    webBrowsing: userBrainPreferences.webBrowsing,
    modelMode: userBrainPreferences.modelMode,
    modelId: userBrainPreferences.modelId,
    responseInstructions: userBrainPreferences.responseInstructions,
  }).from(userBrainPreferences).where(eq(userBrainPreferences.userId, userId)).limit(1);
  return fromRow(row);
}

export function parseAccountBrainPreferences(input: unknown): AccountBrainPreferences {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const effort = BRAIN_EFFORTS.includes(body.effort as AccountBrainEffort)
    ? body.effort as AccountBrainEffort
    : DEFAULT_ACCOUNT_BRAIN_PREFERENCES.effort;
  const selection = body.modelSelection && typeof body.modelSelection === 'object'
    ? body.modelSelection as Record<string, unknown>
    : {};
  const mode = BRAIN_MODEL_MODES.includes(selection.mode as AccountBrainModelMode)
    ? selection.mode as AccountBrainModelMode
    : 'auto';
  const model = typeof selection.model === 'string' ? selection.model.trim().slice(0, 500) : '';
  return {
    effort,
    thinking: body.thinking === true,
    webBrowsing: body.webBrowsing === true,
    modelSelection: mode === 'model' && model ? { mode: 'model', model } : mode === 'byo_pool' ? { mode: 'byo_pool' } : { mode: 'auto' },
    responseInstructions: typeof body.responseInstructions === 'string' ? body.responseInstructions.trim().slice(0, 2_000) : '',
  };
}

export async function setAccountBrainPreferences(db: Db, userId: UserId, input: unknown): Promise<AccountBrainPreferences> {
  const preferences = parseAccountBrainPreferences(input);
  const modelMode = preferences.modelSelection.mode;
  const modelId = modelMode === 'model' ? preferences.modelSelection.model : null;
  await db.insert(userBrainPreferences).values({
    userId,
    effort: preferences.effort,
    thinking: preferences.thinking,
    webBrowsing: preferences.webBrowsing,
    modelMode,
    modelId,
    responseInstructions: preferences.responseInstructions || null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: userBrainPreferences.userId,
    set: {
      effort: preferences.effort,
      thinking: preferences.thinking,
      webBrowsing: preferences.webBrowsing,
      modelMode,
      modelId,
      responseInstructions: preferences.responseInstructions || null,
      updatedAt: new Date(),
    },
  });
  return preferences;
}
