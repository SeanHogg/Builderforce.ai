import { describe, expect, it } from 'vitest';
import { starterWorkspaceName } from './onboarding';

describe('starterWorkspaceName', () => {
  it('uses the display name, then email identity, without exposing implementation defaults', () => {
    expect(starterWorkspaceName({ name: 'Acme', email: 'owner@acme.test' })).toBe("Acme's Workspace");
    expect(starterWorkspaceName({ name: '', email: 'sean@example.test' })).toBe("sean's Workspace");
    expect(starterWorkspaceName(null)).toBe('My workspace');
    expect(starterWorkspaceName({ name: 'Design Workspace' })).toBe('Design Workspace');
  });
});
