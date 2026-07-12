/**
 * GreenStatusIndicator test suite.
 *
 * Verifies FR-1, FR-5 (out-of-range handling), FR-6 (accessibility), and AC-1..AC-9.
 * Mocks are inline to avoid external dependencies (React, icons, etc.).
 */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { GreenStatusIndicator } from '@/components/ui/GreenStatusIndicator';

describe('GreenStatusIndicator', () => {
  afterEach(() => {
    // Reset modules before each test to avoid cross-test leakage
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('Green status rendering (FR-1 and AC-1..AC-3)', () => {
    it('renders Green indicator when score = 75 (lower boundary inclusive)', () => {
      render(<GreenStatusIndicator score={75} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Status: Green, On Track')).toBeInTheDocument();
      const icon = screen.getByRole('img', { name: 'Green indicator' });
      expect(icon).toBeInTheDocument();
    });

    it('renders Green indicator when score = 100 (upper boundary inclusive)', () => {
      render(<GreenStatusIndicator score={100} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Status: Green, On Track')).toBeInTheDocument();
    });

    it('renders Green indicator when score = 87.5 (mid-range)', () => {
      render(<GreenStatusIndicator score={87.5} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Status: Green, On Track')).toBeInTheDocument();
    });

    it('renders Green indicator when score = 90 (typical on-track)', () => {
      render(<GreenStatusIndicator score={90} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Status: Green, On Track')).toBeInTheDocument();
    });
  });

  describe('Not Green rendering (FR-5 and AC-4..AC-6)', () => {
    it('does NOT render Green indicator when score = 74.9 (just below lower boundary)', () => {
      render(<GreenStatusIndicator score={74.9} />);
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

  describe('Visual indicator and label presence (FR-2 and AC-7..AC-10)', () => {
    it('renders icon in all non-icon-only contexts', () => {
      render(<GreenStatusIndicator score={80} />);
      const iconContainer = screen.getByRole('img', { name: /green/i });
      expect(iconContainer).toBeInTheDocument();
    });

    it('renders "On Track" label as visible text in DOM (AC-7)', () => {
      render(<GreenStatusIndicator score={80} />);
      const label = screen.getByText('On Track');
      expect(label).toBeInTheDocument();
    });

    it('renders aria-label including both "Green" and "On Track" (FR-6 and AC-8)', () => {
      render(<GreenStatusIndicator score={80} />);
      const element = screen.getByRole('status').parentElement;
      expect(element).toHaveAttribute(
        'aria-label',
        'Status: Green, On Track'
      );
    });
  });

  describe('Variant handling', () => {
    it('renders icon-only variant without label for container use', () => {
      render(
        <span data-testid="container">
          <GreenStatusIndicator score={80} variant="icon-only" />
        </span>
      );
      const icon = screen.getByRole('img', { name: 'Green indicator' });
      expect(icon).toBeInTheDocument();
      expect(screen.getByText('On Track')).not.toBeInTheDocument(); // No label in icon-only
    });

    it('default variant includes both icon and label', () => {
      render(<GreenStatusIndicator score={80} variant="default" />);
      const icon = screen.getByRole('img', { name: /green/i });
      expect(icon).toBeInTheDocument();
      const label = screen.getByText('On Track');
      expect(label).toBeInTheDocument();
    });
  });

  describe('Custom aria-label override (FR-6 compliance with override)', () => {
    it('uses provided custom aria-label when passed via ariaLabel', () => {
      render(<GreenStatusIndicator score={90} ariaLabel="Status: Green, On Track" />);
      const element = screen.getByRole('status').parentElement;
      expect(element).toHaveAttribute('aria-label', 'Status: Green, On Track');
    });

    it('defaults to canonical aria-label when ariaLabel is omitted', () => {
      render(<GreenStatusIndicator score={80} />);
      const element = screen.getByRole('status').parentElement;
      expect(element).toHaveAttribute('aria-label', 'Status: Green, On Track');
    });
  });
});