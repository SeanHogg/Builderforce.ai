import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasEmailComposer } from './CanvasEmailComposer';
import type { CreationNodeData } from './types';

const api = vi.hoisted(() => ({ providers: vi.fn(), send: vi.fn(), connect: vi.fn() }));

vi.mock('@/lib/mailboxApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mailboxApi')>()),
  mailboxApi: api,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => ({
    mailbox: 'Mailbox', to: 'To', from: 'From', subject: 'Subject', body: 'Body',
    send: 'Send email', sendsFrom: 'Sends from', chooseMailbox: 'Choose a mailbox',
    notConnected: 'Not connected', readyToSend: 'Ready to send', receivedLabel: 'Received',
    loadingMailboxes: 'Checking connected mailboxes…',
    noMailboxHint: 'No mailbox is connected, so this email cannot be sent yet.',
    noSendingMailbox: 'A mailbox is connected, but none of them is allowed to send.',
    anonymousHint: 'This canvas is saved on this device and has no account behind it.',
    integrationSettings: 'Integration settings', openInProvider: 'Open in your mail provider',
    connectProvider: `Connect ${values?.provider ?? ''}`, sent: 'Sent.', sentStatus: 'Sent',
  }[key] || key),
}));

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const CONNECTION = {
  id: 7, provider: 'google' as const, accountEmail: 'me@acme.com', displayName: 'Me',
  status: 'connected', allowSending: true, lastError: null, lastSyncedAt: null, createdAt: '',
};

function draft(overrides: Partial<CreationNodeData> = {}): CreationNodeData {
  return { kind: 'email', title: 'Reviewing my compensation', subject: 'Reviewing my compensation', bodyText: 'Hi Dana, I would like to discuss my salary.', to: ['dana@acme.com'], ...overrides };
}

function renderComposer(data: CreationNodeData, onChange = vi.fn(), persistence: 'local' | 'server' = 'server') {
  render(<CanvasEmailComposer data={data} editable persistence={persistence} onChange={onChange} />);
  return onChange;
}

describe('CanvasEmailComposer', () => {
  beforeEach(() => {
    api.providers.mockReset(); api.send.mockReset(); api.connect.mockReset();
    api.providers.mockResolvedValue({ providers: [{ name: 'google', label: 'Gmail', configured: true }], connections: [CONNECTION] });
  });

  /**
   * The reported defect, 2026-08-14: "the details only have a section for Subject. It's
   * also missing the TO, FROM, etc." An email object had no inspector section at all.
   */
  it('shows the whole message, not just its subject', async () => {
    renderComposer(draft());
    expect(await screen.findByDisplayValue('dana@acme.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Reviewing my compensation')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hi Dana, I would like to discuss my salary.')).toBeInTheDocument();
    expect(screen.getByLabelText(/From/)).toHaveValue('me@acme.com');
  });

  it('names the mailbox a send would leave from, and links to integration settings', async () => {
    renderComposer(draft());
    expect(await screen.findByText('Ready to send')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Sends from/ })).toHaveValue('7');
    expect(screen.getByRole('link', { name: 'Integration settings' })).toHaveAttribute('href', '/settings/integrations');
  });

  /** A Send button with no visible mailbox implies the product will send from somewhere
   *  the user never chose. It must not be offered until one is actually connected. */
  it('will not offer to send when no mailbox is connected', async () => {
    api.providers.mockResolvedValue({ providers: [{ name: 'google', label: 'Gmail', configured: true }], connections: [] });
    renderComposer(draft());
    expect(await screen.findByText(/No mailbox is connected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send email' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled();
  });

  it('treats a mailbox that may not send as not connected for sending', async () => {
    api.providers.mockResolvedValue({ providers: [], connections: [{ ...CONNECTION, allowSending: false }] });
    renderComposer(draft());
    expect(await screen.findByText(/none of them is allowed to send/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send email' })).toBeDisabled();
  });

  it('sends through the resolved mailbox and records what was sent on the object', async () => {
    api.send.mockResolvedValue({ sent: true, id: 'sent-1', accountEmail: 'me@acme.com' });
    const onChange = renderComposer(draft());
    const button = await screen.findByRole('button', { name: 'Send email' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(api.send).toHaveBeenCalledWith(7, {
      to: 'dana@acme.com',
      subject: 'Reviewing my compensation',
      html: 'Hi Dana, I would like to discuss my salary.',
    }));
    // Without `messageId` the object would still read as an unsent draft afterwards.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'sent-1', connectionId: 7, status: 'Sent' })));
  });

  it('renders a pinned message as a record, not a draft to send again', async () => {
    renderComposer(draft({ messageId: 'inbox-9', webUrl: 'https://mail.example/9', from: 'dana@acme.com' }));
    expect(await screen.findByText('Received')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send email' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in your mail provider' })).toHaveAttribute('href', 'https://mail.example/9');
    expect(screen.getByLabelText(/Body/)).toBeDisabled();
  });

  /** A local board has no tenant, so the mailbox fetch would 401. */
  it('does not call the mailbox API on an anonymous canvas', async () => {
    renderComposer(draft(), vi.fn(), 'local');
    expect(await screen.findByText(/saved on this device/)).toBeInTheDocument();
    expect(api.providers).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Integration settings' })).not.toBeInTheDocument();
  });
});
