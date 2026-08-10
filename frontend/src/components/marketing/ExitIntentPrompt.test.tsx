import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExitIntentPrompt } from './ExitIntentPrompt';

const mocks = vi.hoisted(() => ({ authenticated: false }));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mocks.authenticated }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({
    badge: 'Stay connected',
    title: 'Before you go…',
    description: 'Description',
    emailAria: 'Email address',
    emailPlaceholder: 'your@email.com',
    submit: 'Keep me in the loop',
    submitting: 'Subscribing…',
    privacy: 'No spam.',
    successTitle: "You're on the list!",
    successDescription: 'Updates are coming.',
    error: 'Unable to subscribe.',
    close: 'Close',
    closeAria: 'Close exit prompt',
  })[key] ?? key,
}));

describe('ExitIntentPrompt', () => {
  beforeEach(() => {
    mocks.authenticated = false;
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens when an anonymous visitor leaves through the top of the viewport', () => {
    render(<ExitIntentPrompt />);

    fireEvent.mouseLeave(document, { clientY: 4 });

    expect(screen.getByRole('dialog', { name: 'Before you go…' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveFocus();
  });

  it('does not listen for exit intent when the user is authenticated', () => {
    mocks.authenticated = true;
    render(<ExitIntentPrompt />);

    fireEvent.mouseLeave(document, { clientY: 0 });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('honors the seven-day dismissal cooldown', () => {
    localStorage.setItem('bf-exit-intent-dismissed', String(Date.now()));
    render(<ExitIntentPrompt />);

    fireEvent.mouseLeave(document, { clientY: 0 });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('subscribes through the canonical newsletter endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    render(<ExitIntentPrompt />);
    fireEvent.mouseLeave(document, { clientY: 0 });

    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: ' founder@example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep me in the loop' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/newsletter\/subscribers$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'founder@example.com',
          action: 'subscribe',
          source: 'exit-intent',
        }),
      }),
    );
    expect(await screen.findByText("You're on the list!")).toBeInTheDocument();
    expect(localStorage.getItem('bf-exit-intent-dismissed')).toMatch(/^\d+$/);
  });
});

