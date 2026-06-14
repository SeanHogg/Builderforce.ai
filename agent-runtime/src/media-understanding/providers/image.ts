import { minimaxUnderstandImage } from "../../agents/minimax-vlm.js";
import { getApiKeyForModel, requireApiKey } from "../../agents/model-auth.js";
import { ensureBuilderForceAgentsModelsJson } from "../../agents/models-config.js";
import { discoverAuthStorage, discoverModels } from "../../agents/pi-model-discovery.js";
import { coerceImageAssistantText } from "../../agents/tools/image-tool.helpers.js";
import { nativeComplete } from "../../builderforce/model/native-llm.js";
import type { Api, AssistantMessage, Context, Model } from "../../builderforce/model/types.js";
import type { ImageDescriptionRequest, ImageDescriptionResult } from "../types.js";

export async function describeImageWithModel(
  params: ImageDescriptionRequest,
): Promise<ImageDescriptionResult> {
  await ensureBuilderForceAgentsModelsJson(params.cfg, params.agentDir);
  const authStorage = discoverAuthStorage(params.agentDir);
  const modelRegistry = discoverModels(authStorage, params.agentDir);
  const model = modelRegistry.find(params.provider, params.model) as Model<Api> | null;
  if (!model) {
    throw new Error(`Unknown model: ${params.provider}/${params.model}`);
  }
  if (!model.input?.includes("image")) {
    throw new Error(`Model does not support images: ${params.provider}/${params.model}`);
  }
  const apiKeyInfo = await getApiKeyForModel({
    model,
    cfg: params.cfg,
    agentDir: params.agentDir,
    profileId: params.profile,
    preferredProfile: params.preferredProfile,
  });
  const apiKey = requireApiKey(apiKeyInfo, model.provider);
  authStorage.setRuntimeApiKey(model.provider, apiKey);

  const base64 = params.buffer.toString("base64");
  if (model.provider === "minimax") {
    const text = await minimaxUnderstandImage({
      apiKey,
      prompt: params.prompt ?? "Describe the image.",
      imageDataUrl: `data:${params.mime ?? "image/jpeg"};base64,${base64}`,
      modelBaseUrl: model.baseUrl,
    });
    return { text, model: model.id };
  }

  const context: Context = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: params.prompt ?? "Describe the image." },
          { type: "image", data: base64, mimeType: params.mime ?? "image/jpeg" },
        ],
        timestamp: Date.now(),
      },
    ],
  };
  const visionMessages = context.messages.map((m) => ({
    role: m.role as "user",
    content: Array.isArray(m.content)
      ? m.content.map((c) =>
          c.type === "image"
            ? {
                type: "image_url" as const,
                image_url: { url: `data:${c.mimeType};base64,${c.data}` },
              }
            : { type: "text" as const, text: (c as { text: string }).text },
        )
      : (m.content as string),
  }));
  const res = await nativeComplete(
    { baseUrl: model.baseUrl, apiKey, defaultModel: model.id },
    { model: model.id, messages: visionMessages, extra: { max_tokens: params.maxTokens ?? 512 } },
  );
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: res.content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: res.finishReason === "error" ? "error" : "stop",
    timestamp: Date.now(),
  };
  const text = coerceImageAssistantText({
    message,
    provider: model.provider,
    model: model.id,
  });
  return { text, model: model.id };
}
