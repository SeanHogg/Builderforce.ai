/**
 * @vitest-environment jsdom
 *
 * A signed-out visitor missing a capability must see "create an account", never
 * "Requires <Role> role" — the fix for the bug where `/knowledge`'s "+ New
 * document" (and every other `RoleGate`-protected action a guest can reach)
 * told a guest to get a role in an account they don't have.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const permission = vi.hoisted(() => ({
  current: {
    allowed: false,
    role: undefined as 'owner' | 'manager' | 'developer' | 'viewer' | undefined,
    required: 'manager',
    requiredLabel: 'Manager',
  },
}));
vi.mock('@/lib/rbac', () => ({ usePermission: () => permission.current }));

const sampleWorkspace = vi.hoisted(() => ({ current: { ready: true, signedIn: false, isSample: true } }));
vi.mock('@/domains/guest/presentation/useSampleWorkspace', () => ({
  useSampleWorkspace: () => sampleWorkspace.current,
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/knowledge',
}));

import { RoleGate } from './RoleGate';

describe('RoleGate', () => {
  it('renders children plainly when the capability is allowed', () => {
    permission.current = { allowed: true, role: 'manager', required: 'developer', requiredLabel: 'Developer' };
    render(<RoleGate capability="knowledge.create"><button>New document</button></RoleGate>);
    expect(screen.getByRole('button', { name: 'New document' })).toBeEnabled();
  });

  it('shows the honest role hint to a signed-in person below the required role', () => {
    permission.current = { allowed: false, role: 'viewer', required: 'developer', requiredLabel: 'Developer' };
    sampleWorkspace.current = { ready: true, signedIn: true, isSample: false };
    render(<RoleGate capability="knowledge.create"><button>New document</button></RoleGate>);
    expect(screen.getByTitle(/Requires.*role/i)).toBeInTheDocument();
    expect(screen.queryByText('Create an account')).not.toBeInTheDocument();
  });

  it('shows the account CTA, not a role hint, to a signed-out visitor', () => {
    permission.current = { allowed: false, role: undefined, required: 'developer', requiredLabel: 'Developer' };
    sampleWorkspace.current = { ready: true, signedIn: false, isSample: true };
    render(<RoleGate capability="knowledge.create" variant="block"><button>New document</button></RoleGate>);
    expect(screen.getByText('Create an account to unlock this.')).toBeInTheDocument();
    expect(screen.getByText('Create an account')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.queryByText(/Requires.*role/i)).not.toBeInTheDocument();
  });

  it('honors silent on the guest branch — disabled, no visible CTA', () => {
    permission.current = { allowed: false, role: undefined, required: 'developer', requiredLabel: 'Developer' };
    sampleWorkspace.current = { ready: true, signedIn: false, isSample: true };
    render(<RoleGate capability="knowledge.create" silent><button>New document</button></RoleGate>);
    expect(screen.queryByText('Create an account')).not.toBeInTheDocument();
  });
});
