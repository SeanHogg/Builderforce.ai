import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));
vi.mock('@/lib/rbac', () => ({
  useRole: () => 'owner',
  ASSIGNABLE_ROLES: ['viewer', 'developer', 'manager', 'owner'],
}));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));

import { RoleSelect } from './MemberCard';

describe('RoleSelect', () => {
  it('names every role from the catalog and says what the chosen one can do', () => {
    render(<RoleSelect value="manager" onChange={() => {}} />);
    const picker = screen.getByRole('combobox', { name: 'Member role' });
    expect(picker).toHaveTextContent('Manager');
    expect(screen.getByTestId('role-description')).toHaveTextContent(
      'Invite people, manage roles and integrations, and see every insight lens.',
    );

    fireEvent.click(picker);
    expect(screen.getByRole('option', { name: 'Viewer' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Owner' })).toBeInTheDocument();
  });

  it('carries the description as the tooltip in the compact table variant', () => {
    render(<RoleSelect value="viewer" onChange={() => {}} compact />);
    expect(screen.queryByTestId('role-description')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Member role' })).toHaveAttribute(
      'title',
      'Read-only access to boards, work, and the workforce.',
    );
  });
});
