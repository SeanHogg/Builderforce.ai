import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManagerDefaults from './ManagerDefaults';
import { managerApi } from '@/lib/builderforceApi';

vi.mock('next-intl', () => {
  const translators: Record<string, (key: string) => string> = {};
  return { useTranslations: (namespace: string) => translators[namespace] ??= (key: string) => `${namespace}.${key}` };
});
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/rbac', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/lib/builderforceApi', () => ({
  managerApi: { defaults: vi.fn(), updateDefaults: vi.fn() },
}));

const policy = (enabled: boolean) => ({
  enabled,
  managerRef: null,
  managerKind: 'system' as const,
  prMergePolicy: 'on_green' as const,
  autoAssign: true,
  autoBusinessValue: true,
  autoPrioritize: true,
  autoSchedule: true,
  managerType: 'general' as const,
  requireSignoffToComplete: false,
  allowAutoMerge: false,
  allowUnattendedCeremonies: false,
  allowAgentReassignment: false,
  agentReassignIdleHours: 48,
  agentReassignMaxPerSession: 3,
  allowAutoStaffLanes: false,
});

const response = (enabled: boolean) => ({
  defaults: null,
  policy: policy(enabled),
  builtinPolicy: policy(true),
});

describe('ManagerDefaults', () => {
  beforeEach(() => {
    vi.mocked(managerApi.defaults).mockResolvedValue(response(true));
    vi.mocked(managerApi.updateDefaults).mockResolvedValue(response(false));
  });

  it('puts one workspace kill-switch at the top and persists Off immediately', async () => {
    render(<ManagerDefaults />);

    const master = await screen.findByRole('switch', { name: 'manager.policy.enabled.label' });
    expect(master).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radiogroup', { name: 'manager.policy.enabled.label' })).not.toBeInTheDocument();

    fireEvent.click(master);

    await waitFor(() => expect(managerApi.updateDefaults).toHaveBeenCalledWith({ enabled: false }));
    await waitFor(() => expect(master).toHaveAttribute('aria-checked', 'false'));
  });
});
