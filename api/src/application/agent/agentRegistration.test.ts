import { describe, expect, it } from 'vitest';
import {
  effectiveCapabilities,
  normalizeCapabilities,
  normalizeEndpoint,
  normalizeFramework,
  normalizeProtocol,
} from './agentRegistration';

describe('agent registration normalization', () => {
  it('accepts current and future framework slugs without a database enum', () => {
    expect(normalizeFramework(' LangGraph ')).toBe('langgraph');
    expect(normalizeFramework('future_agent.v2')).toBe('future_agent.v2');
    expect(() => normalizeFramework('not a slug')).toThrow(/lowercase slug/);
  });

  it('keeps the wire protocol explicit', () => {
    expect(normalizeProtocol('a2a')).toBe('a2a');
    expect(normalizeProtocol('acp')).toBe('acp');
    expect(() => normalizeProtocol('langgraph')).toThrow(/protocol must be one of/);
  });

  it('normalizes, deduplicates, and merges capabilities', () => {
    expect(normalizeCapabilities([' Code:Review ', 'code:review', 'tools/mcp'])).toEqual([
      'code:review',
      'tools/mcp',
    ]);
    expect(effectiveCapabilities(['tasks:run'], ['tasks:run', 'streaming'])).toEqual([
      'streaming',
      'tasks:run',
    ]);
  });

  it('stores only credential-free HTTP endpoints', () => {
    expect(normalizeEndpoint('https://agents.example.com/a2a/')).toBe('https://agents.example.com/a2a');
    expect(() => normalizeEndpoint('file:///tmp/agent')).toThrow(/HTTP or HTTPS/);
    expect(() => normalizeEndpoint('https://user:secret@example.com')).toThrow(/must not contain credentials/);
  });
});
