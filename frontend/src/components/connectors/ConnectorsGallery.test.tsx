import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectorsGallery } from './ConnectorsGallery';

const api = vi.hoisted(() => ({ catalog: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/connectorsApi', () => ({ connectorsApi: api }));
vi.mock('@/lib/auth', () => ({ getStoredTenant: () => null }));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/connectors/ConnectorBuilder', () => ({ ConnectorBuilder: () => null }));
vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ title }: { title: string }) => <div role="dialog" aria-label={title} />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.catalog.mockResolvedValue({
    connectors: [{
      key: 'github', name: 'GitHub', description: 'Repository tools', category: 'devtools',
      icon: 'GH', origin: 'builtin', actionCount: 2, authKind: 'oauth2', connectionCount: 0,
    }],
  });
  api.get.mockResolvedValue(null);
});

it('opens the linked Platform connector after reading the tenant catalog', async () => {
  render(<ConnectorsGallery initialConnectorKey="github" />);

  expect(await screen.findByRole('dialog', { name: 'GitHub' })).toBeVisible();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('github'));
});

it('ignores a deep link for a connector outside the tenant catalog', async () => {
  render(<ConnectorsGallery initialConnectorKey="unavailable" />);

  expect(await screen.findByText('GitHub')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});
