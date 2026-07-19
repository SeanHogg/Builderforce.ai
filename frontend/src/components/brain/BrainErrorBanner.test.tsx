import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BrainErrorBanner } from './BrainErrorBanner';
import * as cardValidation from '@/lib/useCardValidation';

vi.mock('@/lib/useCardValidation');

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

/**
 * The presentation (verdict → which remedy) is the SHARED brain-ui banner's job and
 * is tested there. What's web-specific — and what these tests pin — is the wiring:
 * an upgrade routes to pricing, a card block drives the $0 SetupIntent flow rather
 * than linking to a `/billing` page that does not exist, and an ordinary failure is
 * never dressed up as a paywall.
 *
 * Copy is the passthrough key under the global next-intl mock (src/test/setup.ts).
 */
const startCardValidation = vi.fn();

describe('BrainErrorBanner', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(cardValidation, 'useStartCardValidation').mockReturnValue({
      start: startCardValidation,
      busy: false,
      error: null,
    });
  });

  it('renders nothing without an error', () => {
    const { container } = render(<BrainErrorBanner error="" action={null} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers no remedy for a failure that is not an entitlement problem', () => {
    const { getByRole } = render(
      <BrainErrorBanner error="Something broke" action={null} onDismiss={vi.fn()} />,
    );
    const alert = getByRole('alert');
    expect(alert.textContent).toContain('Something broke');
    // Dismiss only.
    expect(alert.querySelectorAll('button')).toHaveLength(1);
  });

  it('routes to pricing on an upgrade verdict', () => {
    const { getByText } = render(
      <BrainErrorBanner error="Plan limit reached" action={{ kind: 'upgrade' }} onDismiss={vi.fn()} />,
    );
    fireEvent.click(getByText('brain.upgrade'));
    expect(push).toHaveBeenCalledWith('/pricing?upgrade=pro');
  });

  it('names the required plan when the server supplied one', () => {
    const { getByText } = render(
      <BrainErrorBanner
        error="Requires a paid plan"
        action={{ kind: 'upgrade', requiredPlan: 'pro' }}
        onDismiss={vi.fn()}
      />,
    );
    // The plan-specific CTA wins over the generic one.
    expect(getByText('brain.upgradeToPlan')).toBeTruthy();
  });

  it('starts card validation instead of navigating on a card verdict', () => {
    const { getByText } = render(
      <BrainErrorBanner error="Card required" action={{ kind: 'validate_card' }} onDismiss={vi.fn()} />,
    );
    fireEvent.click(getByText('brain.addCard'));
    expect(startCardValidation).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows a card-validation failure next to the error it was meant to fix', () => {
    vi.spyOn(cardValidation, 'useStartCardValidation').mockReturnValue({
      start: startCardValidation,
      busy: false,
      error: 'Card declined',
    });
    const { getByRole } = render(
      <BrainErrorBanner error="Card required" action={{ kind: 'validate_card' }} onDismiss={vi.fn()} />,
    );
    expect(getByRole('alert').textContent).toContain('Card declined');
  });

  it('falls back to localized copy when a failure carries no quotable message', () => {
    vi.spyOn(cardValidation, 'useStartCardValidation').mockReturnValue({
      start: startCardValidation,
      busy: false,
      error: '',
    });
    const { getByRole } = render(
      <BrainErrorBanner error="Card required" action={{ kind: 'validate_card' }} onDismiss={vi.fn()} />,
    );
    expect(getByRole('alert').textContent).toContain('brain.cardValidationFailed');
  });

  it('offers no reconnect button (web redirects to sign-in globally)', () => {
    const { getByRole } = render(
      <BrainErrorBanner error="Invalid or expired token" action={{ kind: 'auth' }} onDismiss={vi.fn()} />,
    );
    expect(getByRole('alert').querySelectorAll('button')).toHaveLength(1);
  });

  it('dismisses', () => {
    const onDismiss = vi.fn();
    const { getByLabelText } = render(
      <BrainErrorBanner error="Something broke" action={null} onDismiss={onDismiss} />,
    );
    fireEvent.click(getByLabelText('common.dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
