import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const perm = vi.hoisted(() => ({ allowed: true }));
vi.mock('next-intl', () => {
  const translators: Record<string, (key: string) => string> = {};
  return { useTranslations: (namespace: string) => translators[namespace] ??= (key: string) => `${namespace}.${key}` };
});
vi.mock('@/lib/rbac', () => ({ usePermission: () => ({ allowed: perm.allowed, required: 'developer' }) }));

import { MergeGrantToggle, mergeGrantOf } from './MergeGrantToggle';

const noop = () => undefined;

describe('MergeGrantToggle — PRD 48 §4.6', () => {
  it('is DISABLED (not hidden) for a non-cloud target, with why as its tooltip', () => {
    perm.allowed = true;
    render(<MergeGrantToggle value={{ enabled: true, reason: 'hotfix' }} onChange={noop} cloudTarget={false} />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(box.closest('label')?.getAttribute('title')).toBe('mergeGrant.cloudOnly');
    // The reason field is not offered for a target that cannot take the grant.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('is DISABLED (not hidden) for a multi-repo ticket, with why as its tooltip', () => {
    perm.allowed = true;
    render(<MergeGrantToggle value={{ enabled: true, reason: 'hotfix' }} onChange={noop} cloudTarget multiRepo />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(box.closest('label')?.getAttribute('title')).toBe('mergeGrant.multiRepo');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('is DISABLED with the role hint for a role that cannot grant', () => {
    perm.allowed = false;
    render(<MergeGrantToggle value={{ enabled: false, reason: '' }} onChange={noop} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('checkbox').closest('label')?.getAttribute('title')).toBe('common.requiresRoleHint');
  });

  it('asks for the required reason once enabled for a cloud run', () => {
    perm.allowed = true;
    render(<MergeGrantToggle value={{ enabled: true, reason: '' }} onChange={noop} cloudTarget />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByText('mergeGrant.reasonRequired')).toBeInTheDocument();
  });

  it('sends a grant only when enabled with a reason', () => {
    expect(mergeGrantOf({ enabled: true, reason: '  hotfix ' })).toEqual({ reason: 'hotfix' });
    expect(mergeGrantOf({ enabled: true, reason: '  ' })).toBeUndefined();
    expect(mergeGrantOf({ enabled: false, reason: 'hotfix' })).toBeUndefined();
  });
});
