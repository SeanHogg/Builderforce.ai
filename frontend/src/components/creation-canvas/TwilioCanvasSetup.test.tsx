import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwilioCanvasSetup } from './TwilioCanvasSetup';

const api = vi.hoisted(() => ({
  listConnections: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/lib/connectorsApi', () => ({ connectorsApi: api }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => ({
  checking: 'Checking Twilio…', ready: 'Twilio ready', configure: 'Set up Twilio',
  title: 'Twilio integration', crumb: 'Creation Canvas · Settings · Integrations',
  guideTitle: 'Three-step setup', stepCredentials: 'Add credentials.', stepTest: 'Test it.',
  stepReturn: 'Return and run.', connectedStatus: 'Connected.', missingStatus: 'Missing.',
  embedTitle: 'Embed this experience', embedBody: 'Install it on your site.', openEmbed: 'Open embedded capabilities',
}[key] || key) }));

vi.mock('@/components/connectors/ConnectorsGallery', () => ({
  ConnectorConnectionManager: ({ connectorKey }: { connectorKey: string }) => <div>manager:{connectorKey}</div>,
}));

describe('TwilioCanvasSetup', () => {
  beforeEach(() => { api.listConnections.mockReset(); api.get.mockReset(); });

  it('stays out of unrelated canvases', () => {
    const { container } = render(<TwilioCanvasSetup active={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.listConnections).not.toHaveBeenCalled();
  });

  it('shows the canonical setup inside Canvas when Twilio is missing', async () => {
    api.listConnections.mockResolvedValue([]);
    render(<TwilioCanvasSetup active />);
    expect(await screen.findByRole('button', { name: 'Set up Twilio' })).toHaveAttribute('data-tour', 'twilio-integration');
    fireEvent.click(screen.getByRole('button', { name: 'Set up Twilio' }));
    expect(screen.getByRole('dialog', { name: 'Twilio integration' })).toBeInTheDocument();
    expect(screen.getByText('manager:twilio')).toBeInTheDocument();
    expect(screen.getByText('Add credentials.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open embedded capabilities →' })).toHaveAttribute('href', '/embedded');
  });

  it('reports an enabled existing connection as ready', async () => {
    api.listConnections.mockResolvedValue([{ id: 'c1', enabled: true }]);
    render(<TwilioCanvasSetup active />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Twilio ready' })).toHaveAttribute('data-ready', 'true'));
  });
});
