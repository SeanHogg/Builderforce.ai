export const AGENT_PROTOCOLS = ['a2a', 'acp', 'builderforce-worker', 'native-http'] as const;
export type AgentProtocol = typeof AGENT_PROTOCOLS[number];

export const AGENT_HEALTH_STATUSES = ['unknown', 'online', 'offline', 'degraded'] as const;
export type AgentHealthStatus = typeof AGENT_HEALTH_STATUSES[number];

export const SUPPORTED_AGENT_FRAMEWORKS = [
  { id: 'langgraph', name: 'LangGraph', protocols: ['a2a', 'builderforce-worker'] },
  { id: 'microsoft-agent-framework', name: 'Microsoft Agent Framework', protocols: ['a2a', 'builderforce-worker'] },
  { id: 'pydantic-ai', name: 'Pydantic AI', protocols: ['builderforce-worker', 'native-http'] },
  { id: 'crewai', name: 'CrewAI', protocols: ['builderforce-worker', 'native-http'] },
  { id: 'openai-agents', name: 'OpenAI Agents SDK', protocols: ['builderforce-worker', 'native-http'] },
  { id: 'google-adk', name: 'Google ADK', protocols: ['a2a', 'builderforce-worker'] },
  { id: 'claude', name: 'Claude', protocols: ['acp', 'builderforce-worker', 'native-http'] },
  { id: 'openclaw', name: 'OpenClaw', protocols: ['builderforce-worker', 'native-http'] },
  { id: 'hermes', name: 'Hermes', protocols: ['acp', 'native-http'] },
] as const;

const MAX_CAPABILITIES = 128;
const MAX_CAPABILITY_LENGTH = 120;

export function normalizeFramework(value: unknown): string {
  if (typeof value !== 'string') throw new Error('framework is required');
  const framework = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(framework)) {
    throw new Error('framework must be a lowercase slug of at most 64 characters');
  }
  return framework;
}

export function normalizeProtocol(value: unknown): AgentProtocol {
  if (typeof value !== 'string' || !AGENT_PROTOCOLS.includes(value as AgentProtocol)) {
    throw new Error(`protocol must be one of: ${AGENT_PROTOCOLS.join(', ')}`);
  }
  return value as AgentProtocol;
}

export function normalizeHealthStatus(value: unknown): AgentHealthStatus {
  if (typeof value !== 'string' || !AGENT_HEALTH_STATUSES.includes(value as AgentHealthStatus)) {
    throw new Error(`healthStatus must be one of: ${AGENT_HEALTH_STATUSES.join(', ')}`);
  }
  return value as AgentHealthStatus;
}

export function normalizeCapabilities(value: unknown, field = 'capabilities'): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`);
  if (value.length > MAX_CAPABILITIES) throw new Error(`${field} may contain at most ${MAX_CAPABILITIES} entries`);
  const capabilities = value.map((entry) => {
    if (typeof entry !== 'string') throw new Error(`${field} must be an array of strings`);
    const normalized = entry.trim().toLowerCase();
    if (!normalized || normalized.length > MAX_CAPABILITY_LENGTH || !/^[a-z0-9][a-z0-9:._/-]*$/.test(normalized)) {
      throw new Error(`${field} entries must be capability slugs of at most ${MAX_CAPABILITY_LENGTH} characters`);
    }
    return normalized;
  });
  return [...new Set(capabilities)].sort();
}

export function effectiveCapabilities(declared: string[], discovered: string[]): string[] {
  return [...new Set([...declared, ...discovered])].sort();
}

export function normalizeEndpoint(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('endpoint must be a URL of at most 2048 characters');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('endpoint must be a valid HTTP or HTTPS URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('endpoint must use HTTP or HTTPS');
  if (url.username || url.password) throw new Error('endpoint must not contain credentials');
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function normalizeJsonObject(value: unknown, field: string, maxBytes: number): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) throw new Error(`${field} is too large`);
  return value as Record<string, unknown>;
}

