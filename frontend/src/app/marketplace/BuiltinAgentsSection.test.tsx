/**
 * The Built-in chip renders the roster, not the public registry.
 *
 * Built-in agents are provisioned unpublished, so the public registry never
 * returned one and this chip was empty for every visitor. These pin that the
 * section reads the roster and offers "open", never "hire".
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuiltinAgentsSection } from './BuiltinAgentsSection';
import type { BuiltinAgentEntry } from '@/lib/types';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const builtinAgentsMock = vi.fn<() => Promise<BuiltinAgentEntry[]>>();
vi.mock('@/lib/marketplace/marketplaceReads', () => ({
  marketplaceReads: { builtinAgents: () => builtinAgentsMock() },
}));

let isAuthenticated = false;
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ isAuthenticated }) }));

const ROSTER: BuiltinAgentEntry[] = [
  { kind: 'validator', name: 'Validator', title: 'Validator — Team Lead', bio: 'Reviews Done work.', skills: ['code-review'] },
  { kind: 'security', name: 'Security', title: 'Security — SOC 2 Auditor', bio: 'Audits the codebase.', skills: ['soc2'] },
  { kind: 'ceo', name: 'CEO', title: 'CEO — owns the portfolio', bio: 'Owns the whole picture.', skills: ['strategy'] },
];

beforeEach(() => {
  builtinAgentsMock.mockReset();
  builtinAgentsMock.mockResolvedValue(ROSTER);
  isAuthenticated = false;
});

describe('BuiltinAgentsSection', () => {
  it('renders every seat of the roster', async () => {
    render(<BuiltinAgentsSection search="" />);
    for (const agent of ROSTER) expect(await screen.findByText(agent.name)).toBeTruthy();
    expect(screen.queryByText('Hire')).toBeNull();
  });

  it('filters by the storefront search and honours the limit', async () => {
    const { unmount } = render(<BuiltinAgentsSection search="soc2" />);
    expect(await screen.findByText('Security')).toBeTruthy();
    expect(screen.queryByText('Validator')).toBeNull();
    unmount();
    render(<BuiltinAgentsSection search="" limit={2} />);
    expect(await screen.findByText('Validator')).toBeTruthy();
    expect(screen.queryByText('CEO')).toBeNull();
  });

  it('sends a guest through sign-in and a member straight to the workforce', async () => {
    const { unmount } = render(<BuiltinAgentsSection search="" limit={1} />);
    const guestLink = await screen.findByRole('link');
    expect(guestLink.getAttribute('href')).not.toBe('/workforce');
    expect(guestLink.getAttribute('href')).toContain('workforce');
    unmount();
    isAuthenticated = true;
    render(<BuiltinAgentsSection search="" limit={1} />);
    expect((await screen.findByRole('link')).getAttribute('href')).toBe('/workforce');
  });

  it('says so when nothing matches', async () => {
    render(<BuiltinAgentsSection search="no-such-skill" />);
    expect(await screen.findByText('No built-in agent matches your search.')).toBeTruthy();
  });
});
