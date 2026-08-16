import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  sessionAppState: vi.fn(),
  addressAvailable: vi.fn(),
  convertToApp: vi.fn(),
  appAddress: vi.fn(),
  overview: vi.fn(),
}));

vi.mock('@/lib/embeddedApps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/embeddedApps')>()),
  embeddedAppsApi: api,
}));

const { CanvasAppPanel } = await import('./CanvasAppPanel');

const CONVERTED = { projectId: 42, projectKey: 'SUN', name: 'Sunday RSVP', subdomain: 'sunday-rsvp' };

beforeEach(() => {
  for (const spy of Object.values(api)) spy.mockReset();
  api.appAddress.mockResolvedValue('https://sunday-rsvp.builderforce.app');
  api.addressAvailable.mockResolvedValue({
    label: 'sunday-rsvp', available: true, reason: 'ok', host: 'sunday-rsvp.builderforce.app',
  });
});

describe('CanvasAppPanel — deciding its own state', () => {
  /**
   * A local, signed-out board has no server session, so there is nothing to
   * convert. Rendering nothing is the correct answer, not an error state — and
   * it must be reached without the caller passing a flag.
   */
  it('renders nothing for a board with no server session', () => {
    const { container } = render(<CanvasAppPanel sessionId={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.sessionAppState).not.toHaveBeenCalled();
  });

  /**
   * `convert-to-app` is editor+. A viewer on a board that is still only a board
   * has nothing to do and nothing to look at, so the component removes itself
   * rather than offering an action the server would refuse.
   */
  it('renders nothing for a viewer on a board that is not an app', async () => {
    api.sessionAppState.mockResolvedValue({ app: null, role: 'viewer', title: 'Sunday RSVP' });
    const { container } = render(<CanvasAppPanel sessionId="board-1" />);
    await waitFor(() => expect(api.sessionAppState).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  /** A viewer on a board that IS an app still gets to see what it became. */
  it('still reports the app to a viewer once it exists', async () => {
    api.sessionAppState.mockResolvedValue({ app: CONVERTED, role: 'viewer', title: 'Sunday RSVP' });
    render(<CanvasAppPanel sessionId="board-1" />);
    expect(await screen.findByRole('button', { name: /triggerOpen/ })).toBeInTheDocument();
  });

  it('offers the conversion to an editor', async () => {
    api.sessionAppState.mockResolvedValue({ app: null, role: 'editor', title: 'Sunday RSVP' });
    render(<CanvasAppPanel sessionId="board-1" />);
    expect(await screen.findByRole('button', { name: /triggerConvert/ })).toBeInTheDocument();
  });
});

describe('CanvasAppPanel — the one click', () => {
  it('pre-fills the address from the board title so the common case is one click', async () => {
    api.sessionAppState.mockResolvedValue({ app: null, role: 'owner', title: 'Sunday RSVP' });
    render(<CanvasAppPanel sessionId="board-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /triggerConvert/ }));
    await waitFor(() => expect(screen.getByLabelText(/addressLabel/)).toHaveValue('Sunday RSVP'));
  });

  /**
   * The server is the arbiter of what a label becomes and whether it is free.
   * The field shows the SERVER's normalised answer rather than a second
   * implementation's guess.
   */
  it('will not convert until the server says the address is free', async () => {
    api.sessionAppState.mockResolvedValue({ app: null, role: 'owner', title: 'Sunday RSVP' });
    api.addressAvailable.mockResolvedValue({
      label: 'sunday-rsvp', available: false, reason: 'taken', host: null,
    });
    render(<CanvasAppPanel sessionId="board-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /triggerConvert/ }));

    await screen.findByText(/addressTaken/);
    expect(screen.getByRole('button', { name: /convertAction/ })).toBeDisabled();
    expect(api.convertToApp).not.toHaveBeenCalled();
  });

  it('converts, then states the address it claimed', async () => {
    api.sessionAppState
      .mockResolvedValueOnce({ app: null, role: 'owner', title: 'Sunday RSVP' })
      .mockResolvedValue({ app: CONVERTED, role: 'owner', title: 'Sunday RSVP' });
    api.convertToApp.mockResolvedValue({
      ...CONVERTED, sessionId: 'board-1', host: 'sunday-rsvp.builderforce.app', created: true,
    });

    render(<CanvasAppPanel sessionId="board-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /triggerConvert/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /convertAction/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /convertAction/ }));

    await waitFor(() => expect(api.convertToApp).toHaveBeenCalledWith('board-1', 'Sunday RSVP'));
    expect(await screen.findByText('sunday-rsvp.builderforce.app')).toBeInTheDocument();
  });

  /**
   * A 409 for a name somebody took between the check and the press is a normal
   * outcome of a race, and the creator has to be told which one it was.
   */
  it('shows the server refusal beside the field rather than swallowing it', async () => {
    api.sessionAppState.mockResolvedValue({ app: null, role: 'owner', title: 'Sunday RSVP' });
    api.convertToApp.mockRejectedValue(new Error('sunday-rsvp is already taken. Choose another address.'));

    render(<CanvasAppPanel sessionId="board-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /triggerConvert/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /convertAction/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /convertAction/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already taken');
  });

  /**
   * The session read carries a LABEL and cannot carry the hosting apex, so the
   * URL comes from the site row. Concatenating one here would be a second copy
   * of a deployment constant.
   */
  it('takes the URL from the site read, not from the subdomain plus a guess', async () => {
    api.sessionAppState.mockResolvedValue({ app: CONVERTED, role: 'owner', title: 'Sunday RSVP' });
    render(<CanvasAppPanel sessionId="board-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /triggerOpen/ }));
    await waitFor(() => expect(api.appAddress).toHaveBeenCalledWith(42));
    expect(await screen.findByRole('link', { name: 'sunday-rsvp.builderforce.app' }))
      .toHaveAttribute('href', 'https://sunday-rsvp.builderforce.app');
  });
});
