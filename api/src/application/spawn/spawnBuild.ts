/**
 * ONE SPAWN BUILD — a creator's request in, operations for their place out.
 *
 *   1. Gate: old enough, a member, and a wallet that can start a build. Checked
 *      BEFORE the model call, because a build that is refused afterwards has
 *      already cost the platform the tokens.
 *   2. Ask the coding pool for operations against the place as it is now.
 *   3. Read the operations through the safety gate (`spawnOps.ts`).
 *   4. Debit the wallet for exactly the tokens the model used — and only when the
 *      build produced something. A generator failure, an unreadable answer, a
 *      build whose every operation was refused, or a request the model declined
 *      costs the creator nothing: paying for a build that did not happen is the
 *      complaint every Roblox AI tool earns first.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { completeJson, JSON_OBJECT_FORMAT } from '../llm/completeJson';
import { MIN_BUILD_TOKENS } from './spawnCatalog';
import { SpawnError } from './spawnErrors';
import { assertSpawnMember } from './spawnMembership';
import { readSpawnOps, type RejectedOp, type SpawnOp } from './spawnOps';
import { readBuildRequest, renderBuildUserMessage, SPAWN_SYSTEM_PROMPT } from './spawnPrompt';
import { spawnWallet } from './spawnWallet';

const MAX_OUTPUT_TOKENS = 12_000;
/** A reply's characters per token, for the rare upstream that reports no usage. */
const CHARS_PER_TOKEN = 4;

export interface SpawnBuildResult {
  buildId: string;
  reply: string;
  refused: boolean;
  ops: SpawnOp[];
  rejected: RejectedOp[];
  next: string[];
  tokensUsed: number;
  balance: number;
}

interface ModelAnswer {
  reply: string;
  refused: boolean;
  ops: unknown;
  next: string[];
}

function readAnswer(value: unknown): ModelAnswer | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const reply = typeof raw.reply === 'string' ? raw.reply.trim().slice(0, 2_000) : '';
  if (!reply && !Array.isArray(raw.ops)) return null;
  return {
    reply,
    refused: raw.refused === true,
    ops: raw.ops,
    next: (Array.isArray(raw.next) ? raw.next : [])
      .filter((n): n is string => typeof n === 'string' && !!n.trim())
      .slice(0, 3)
      .map((n) => n.trim().slice(0, 140)),
  };
}

export async function runSpawnBuild(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; body: unknown },
): Promise<SpawnBuildResult> {
  const request = readBuildRequest(input.body);
  if (!request.prompt) throw new SpawnError('Tell Spawn what to build', 400, 'prompt_empty');

  await assertSpawnMember(db, env, { tenantId: input.tenantId, userId: input.userId });
  const affordable = await spawnWallet.reserve(db, env, input.tenantId, MIN_BUILD_TOKENS);
  if (!affordable.ok) throw new SpawnError('You are out of Spawn tokens', 402, 'insufficient_tokens');

  const buildId = crypto.randomUUID();
  const userMessage = renderBuildUserMessage(request);
  const out = await completeJson(
    { kind: 'tenant', env, tenantId: input.tenantId, opts: { codingOnly: true, meterUseCase: 'spawn_build', userId: input.userId } },
    {
      system: SPAWN_SYSTEM_PROMPT,
      user: userMessage,
      schema: JSON_OBJECT_FORMAT,
      temperature: 0.3,
      maxTokens: MAX_OUTPUT_TOKENS,
      useCase: 'spawn_build',
    },
    readAnswer,
  );

  if (!out.ok) {
    if (out.reason === 'gateway') throw new SpawnError('Spawn could not reach its builder. Try again in a moment.', 502, 'generator_unavailable');
    throw new SpawnError('Spawn got muddled on that one. Try saying it a different way.', 502, 'generator_unreadable');
  }

  const answer = out.value;
  const { ops, rejected } = answer.refused ? { ops: [], rejected: [] } : readSpawnOps(answer.ops);
  const proposedAny = Array.isArray(answer.ops) && answer.ops.length > 0;
  // Every operation refused: nothing reaches the place, so nothing is charged.
  if (!answer.refused && proposedAny && ops.length === 0) {
    throw new SpawnError('Spawn could not build that safely. Try asking a different way.', 502, 'generator_unreadable');
  }

  const usage = out.result?.usage;
  const tokensUsed = usage?.totalTokens
    || (usage ? usage.promptTokens + usage.completionTokens : 0)
    || Math.ceil((SPAWN_SYSTEM_PROMPT.length + userMessage.length + JSON.stringify(answer).length) / CHARS_PER_TOKEN);

  if (!answer.refused) {
    await spawnWallet.debit(db, env, {
      tenantId: input.tenantId,
      amount: tokensUsed,
      reference: `spawn:build:${buildId}`,
      memo: `Build — ${request.prompt.slice(0, 80)}`,
      metadata: { buildId, ops: ops.length, rejected: rejected.length, model: out.model },
    });
  }

  return {
    buildId,
    reply: answer.reply,
    refused: answer.refused,
    ops,
    rejected,
    next: answer.next,
    tokensUsed: answer.refused ? 0 : tokensUsed,
    balance: await spawnWallet.balance(db, env, input.tenantId),
  };
}
