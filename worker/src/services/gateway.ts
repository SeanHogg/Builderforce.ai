export type GatewayChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export interface GatewayEnv {
  BUILDERFORCE_API_BASE_URL?: string;
}

type GatewayChatRequest = {
  env: GatewayEnv;
  authToken: string;
  messages: GatewayChatMessage[];
  maxTokens?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  response?: string;
};

function getApiBaseUrl(env: GatewayEnv): string {
  return (env.BUILDERFORCE_API_BASE_URL ?? 'https://api.builderforce.ai').replace(/\/$/, '');
}

function looksLikeJwt(token: string): boolean {
  return /^[^.]+\.[^.]+\.[^.]+$/.test(token);
}

export function requireGatewayAuthToken(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new Error('Missing bearer token');
  if (!(token.startsWith('clk_') || looksLikeJwt(token))) {
    throw new Error('Gateway auth requires a workspace JWT or clk_* key');
  }
  return token;
}

function extractAssistantText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  if (typeof payload.response === 'string') return payload.response;
  return '';
}

export async function requestGatewayCompletion(req: GatewayChatRequest): Promise<string> {
  const response = await fetch(`${getApiBaseUrl(req.env)}/llm/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${req.authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: req.messages,
      stream: false,
      ...(typeof req.maxTokens === 'number' ? { max_tokens: req.maxTokens } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gateway call failed (${response.status}): ${errorText || response.statusText}`);
  }

  const payload = await response.json() as ChatCompletionResponse;
  return extractAssistantText(payload);
}
