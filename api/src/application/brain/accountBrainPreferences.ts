import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { settings } from '../../infrastructure/database/schema';
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

const BRAIN_SETTINGS_FEATURE = 'brain';

export async function getAccountBrainPreferences(db: Db, tenantId: number, userId: UserId): Promise<AccountBrainPreferences> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(and(
    eq(settings.tenantId, tenantId),
    eq(settings.scope, 'user'),
    eq(settings.scopeRef, userId),
    eq(settings.feature, BRAIN_SETTINGS_FEATURE),
  )).limit(1);
  return row ? parseAccountBrainPreferences(row.value) : DEFAULT_ACCOUNT_BRAIN_PREFERENCES;
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

export async function setAccountBrainPreferences(db: Db, tenantId: number, userId: UserId, input: unknown): Promise<AccountBrainPreferences> {
  const preferences = parseAccountBrainPreferences(input);
  await db.insert(settings).values({
    tenantId,
    scope: 'user',
    scopeRef: userId,
    feature: BRAIN_SETTINGS_FEATURE,
    value: preferences,
    updatedBy: userId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [settings.tenantId, settings.scope, settings.scopeRef, settings.feature],
    set: {
      value: preferences,
      updatedBy: userId,
      updatedAt: new Date(),
    },
  });
  return preferences;
}
