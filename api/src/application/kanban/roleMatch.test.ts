import { describe, expect, it } from 'vitest';
import { agentMatchesRole } from './roleMatch';

describe('agentMatchesRole', () => {
  it('matches the role key or display name', () => {
    expect(agentMatchesRole({ name: 'Bob Developer' }, 'developer', 'Developer')).toBe(true);
    expect(agentMatchesRole({ name: 'Ada', title: 'Senior Product Agent' }, 'developer', 'Developer')).toBe(false);
  });

  it('reads a coder as a developer (chat #134)', () => {
    expect(agentMatchesRole({ name: 'John Coder ((V2) (Durable))', title: 'Coder Agent (V2) (Durable)' }, 'developer', 'Developer')).toBe(true);
    expect(agentMatchesRole({ name: 'Sam', title: 'Software Engineer' }, 'developer', 'Developer')).toBe(true);
  });

  it('matches synonyms as whole words only', () => {
    expect(agentMatchesRole({ name: 'Video Decoder' }, 'developer', 'Developer')).toBe(false);
    expect(agentMatchesRole({ name: 'Quinn', title: 'QA Agent' }, 'qa-tester', 'QA Tester')).toBe(true);
    expect(agentMatchesRole({ name: 'Aqab' }, 'qa-tester', 'QA Tester')).toBe(false);
  });
});
