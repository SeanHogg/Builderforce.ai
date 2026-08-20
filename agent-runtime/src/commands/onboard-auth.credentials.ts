/**
 * Credential setters for the onboarding wizard — one per provider.
 *
 * EVERY call to `upsertAuthProfile` here is awaited, and that is load-bearing.
 * It returns a promise; until 2026-08 all nineteen setters dropped it on the
 * floor, so `await setHuggingfaceApiKey(key)` resolved BEFORE the token reached
 * disk. On Linux the write usually won the race against whatever came next and
 * nothing looked wrong; on Windows it did not, which is how the wizard's own
 * tests found it — reading back a profile the setter had already claimed to have
 * written, and getting ENOENT, then ENOTEMPTY as the late write raced the
 * fixture teardown. In the product the same race means an onboarding flow that
 * exits (or a gateway that starts) before the credential exists.
 *
 * `setQianfanApiKey` and `setXaiApiKey` were not even declared async, so their
 * callers had nothing to await at all.
 */
import type { OAuthCredentials } from "../builderforce/model/types.js";
import { resolveBuilderForceAgentsAgentDir } from "../agents/agent-paths.js";
import { upsertAuthProfile } from "../agents/auth-profiles.js";
export { CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF } from "../agents/cloudflare-ai-gateway.js";
export { XAI_DEFAULT_MODEL_REF } from "./onboard-auth.models.js";

const resolveAuthAgentDir = (agentDir?: string) => agentDir ?? resolveBuilderForceAgentsAgentDir();

export async function writeOAuthCredentials(
  provider: string,
  creds: OAuthCredentials,
  agentDir?: string,
): Promise<void> {
  const email =
    typeof creds.email === "string" && creds.email.trim() ? creds.email.trim() : "default";
  await upsertAuthProfile({
    profileId: `${provider}:${email}`,
    credential: {
      type: "oauth",
      provider,
      ...creds,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setAnthropicApiKey(key: string, agentDir?: string) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  await upsertAuthProfile({
    profileId: "anthropic:default",
    credential: {
      type: "api_key",
      provider: "anthropic",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setGeminiApiKey(key: string, agentDir?: string) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  await upsertAuthProfile({
    profileId: "google:default",
    credential: {
      type: "api_key",
      provider: "google",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setMinimaxApiKey(
  key: string,
  agentDir?: string,
  profileId: string = "minimax:default",
) {
  const provider = profileId.split(":")[0] ?? "minimax";
  // Write to resolved agent dir so gateway finds credentials on startup.
  await upsertAuthProfile({
    profileId,
    credential: {
      type: "api_key",
      provider,
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setMoonshotApiKey(key: string, agentDir?: string) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  await upsertAuthProfile({
    profileId: "moonshot:default",
    credential: {
      type: "api_key",
      provider: "moonshot",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setKimiCodingApiKey(key: string, agentDir?: string) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  await upsertAuthProfile({
    profileId: "kimi-coding:default",
    credential: {
      type: "api_key",
      provider: "kimi-coding",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setSyntheticApiKey(key: string, agentDir?: string) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  await upsertAuthProfile({
    profileId: "synthetic:default",
    credential: {
      type: "api_key",
      provider: "synthetic",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setVeniceApiKey(key: string, agentDir?: string) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  await upsertAuthProfile({
    profileId: "venice:default",
    credential: {
      type: "api_key",
      provider: "venice",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export const ZAI_DEFAULT_MODEL_REF = "zai/glm-5";
export const XIAOMI_DEFAULT_MODEL_REF = "xiaomi/mimo-v2-flash";
export const OPENROUTER_DEFAULT_MODEL_REF = "openrouter/auto";
export const HUGGINGFACE_DEFAULT_MODEL_REF = "huggingface/deepseek-ai/DeepSeek-R1";
export const TOGETHER_DEFAULT_MODEL_REF = "together/moonshotai/Kimi-K2.5";
export const LITELLM_DEFAULT_MODEL_REF = "litellm/claude-opus-4-6";
export const VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF = "vercel-ai-gateway/anthropic/claude-opus-4.6";

export async function setZaiApiKey(key: string, agentDir?: string) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  await upsertAuthProfile({
    profileId: "zai:default",
    credential: {
      type: "api_key",
      provider: "zai",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setXiaomiApiKey(key: string, agentDir?: string) {
  await upsertAuthProfile({
    profileId: "xiaomi:default",
    credential: {
      type: "api_key",
      provider: "xiaomi",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setOpenrouterApiKey(key: string, agentDir?: string) {
  // Never persist the literal "undefined" (e.g. when prompt returns undefined and caller used String(key)).
  const safeKey = key === "undefined" ? "" : key;
  await upsertAuthProfile({
    profileId: "openrouter:default",
    credential: {
      type: "api_key",
      provider: "openrouter",
      key: safeKey,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setCloudflareAiGatewayConfig(
  accountId: string,
  gatewayId: string,
  apiKey: string,
  agentDir?: string,
) {
  const normalizedAccountId = accountId.trim();
  const normalizedGatewayId = gatewayId.trim();
  const normalizedKey = apiKey.trim();
  await upsertAuthProfile({
    profileId: "cloudflare-ai-gateway:default",
    credential: {
      type: "api_key",
      provider: "cloudflare-ai-gateway",
      key: normalizedKey,
      metadata: {
        accountId: normalizedAccountId,
        gatewayId: normalizedGatewayId,
      },
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setLitellmApiKey(key: string, agentDir?: string) {
  await upsertAuthProfile({
    profileId: "litellm:default",
    credential: {
      type: "api_key",
      provider: "litellm",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setVercelAiGatewayApiKey(key: string, agentDir?: string) {
  await upsertAuthProfile({
    profileId: "vercel-ai-gateway:default",
    credential: {
      type: "api_key",
      provider: "vercel-ai-gateway",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setOpencodeZenApiKey(key: string, agentDir?: string) {
  await upsertAuthProfile({
    profileId: "opencode:default",
    credential: {
      type: "api_key",
      provider: "opencode",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setTogetherApiKey(key: string, agentDir?: string) {
  await upsertAuthProfile({
    profileId: "together:default",
    credential: {
      type: "api_key",
      provider: "together",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setHuggingfaceApiKey(key: string, agentDir?: string) {
  await upsertAuthProfile({
    profileId: "huggingface:default",
    credential: {
      type: "api_key",
      provider: "huggingface",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setQianfanApiKey(key: string, agentDir?: string) {
  await upsertAuthProfile({
    profileId: "qianfan:default",
    credential: {
      type: "api_key",
      provider: "qianfan",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

export async function setXaiApiKey(key: string, agentDir?: string) {
  await upsertAuthProfile({
    profileId: "xai:default",
    credential: {
      type: "api_key",
      provider: "xai",
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}
