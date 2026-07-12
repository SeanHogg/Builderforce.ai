/** GreenStatusIndicator spec and test suite. */
import { render, screen } from '@testing-library/react';
import 'jest-dom';
import { GreenStatusIndicator } from '@/components/ui/GreenStatusIndicator';

describe('GreenStatusIndicator', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('Green status rendering (FR‑1 and AC‑1..AC‑3)', () => {
    it('renders Green indicator when score = 75 (lower boundary inclusive)', () => {
      render(<GreenStatusIndicator score={75} />);
      // role="status" per intended behavior
      expect(screen.getByRole('status')).toBeInTheDocument();
      // FR‑2 visible friendly label "On Track"
      expect(screen.getByText('On Track')).toBeInTheDocument();
    });

    it('renders Green indicator when score = 100 (upper boundary inclusive)', () => {
      render(<GreenStatusIndicator score={100} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('On Track')).toBeInTheDocument();
    });

    it('renders Green indicator when score = 87.5 (mid-range)', () => {
      render(<GreenStatusIndicator score={87.5} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('On Track')).toBeInTheDocument();
    });

    it('renders Green indicator when score = 90 (typical on-track)', () => {
      render(<GreenStatusIndicator score={90} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('On Track')).toBeInTheDocument();
    });
  });

  describe('Not Green rendering (FR‑5 and AC‑4..AC‑6)', () => {
    it('does NOT render Green indicator when score = 74.9 (just below lower boundary)', () => {
      render(<GreenStatusIndicator score={74.9} />);
      // No status role element
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does NOT render Green indicator when score = 100.1 (just above upper boundary)', () => {
      render(<GreenStatusIndicator score={100.1} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does NOT render Green indicator when score is null', () => {
      render(<GreenStatusIndicator score={null} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does NOT render Green indicator when score is undefined', () => {
      render(<GreenStatusIndicator score={undefined} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does NOT render Green indicator when score < 0 (invalid negative)', () => {
      render(<GreenStatusIndicator score={-5} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('Visual indicator and label presence in default variant (FR‑2 and AC‑7..AC‑10)', () => {
    it('renders accessible role="status"', () => {
      render(<GreenStatusIndicator score={80} />);
      const statusEl = screen.getByRole('status');
      expect(statusEl).toBeInTheDocument();
    });

    it('renders icon in all non-icon-only contexts', () => {
      render(<GreenStatusIndicator score={80} />);
      const iconEl = screen.getByText('On Track').previousElementSibling;
      expect(iconEl).toBeInTheDocument();
    });

    it('renders "On Track" label as visible text in DOM (AC‑7)', () => {
      render(<GreenStatusIndicator score={80} />);
      const label = screen.getByText('On Track');
      expect(label).toBeInTheDocument();
    });

    it('renders aria-label including both "Green" and "On Track" for screen readers (FR‑6 and AC‑8)', () => {
      render(<GreenStatusIndicator score={80} />);
      const statusEl = screen.getByRole('status');
      expect(statusEl).toHaveAttribute('aria-label', 'Status: Green, On Track');
    });
  });

  describe('Variant handling', () => {
    it('renders icon-only variant without label for container use', () => {
      render(
        <span data-testid="container">
          <GreenStatusIndicator score={80} variant="icon-only" />
        </span>,
      );
      const icon = screen.getByRole('img', { name: 'Green indicator' });
      expect(icon).toBeInTheDocument();
      // No "On Track" visible label
      expect(screen.queryByText('On Track')).not.toBeInTheDocument();
    });

    it('default variant includes both icon and visible label', () => {
      render(<GreenStatusIndicator score={80} variant="default" />);
      const iconEl = screen.getByText('On Track').previousElementSibling;
      expect(iconEl).toBeInTheDocument();
      const label = screen.getByText('On Track');
      expect(label).toBeInTheDocument();
    });
  });

  describe('Custom aria-label override (FR‑6 compliance with override)', () => {
    it('uses provided custom aria-label when passed via ariaLabel', () => {
      render(<GreenStatusIndicator score={90} ariaLabel="Status: Green, On Track" />);
      const statusEl = screen.getByRole('status');
      expect(statusEl).toHaveAttribute('aria-label', 'Status: Green, On Track');
    });

    it('defaults to canonical aria-label when ariaLabel is omitted', () => {
      render(<GreenStatusIndicator score={80} />);
      const statusEl = screen.getByRole('status');
      expect(statusEl).toHaveAttribute('aria-label', 'Status: Green, On Track');
    });
  });
});