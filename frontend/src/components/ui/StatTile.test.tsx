import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('renders the label and value', () => {
    render(<StatTile label="Visitors" value="42" />);
    expect(screen.getByText('Visitors')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders the hint when provided', () => {
    render(<StatTile label="Converted" value="7" hint="12%" />);
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  it('omits the hint when it is not provided', () => {
    const { container } = render(<StatTile label="Visits" value="9" />);
    expect(container.querySelectorAll('.text-muted')).toHaveLength(1);
  });

  it('colours the value with the success tone', () => {
    render(<StatTile label="Converted" value="7" tone="success" />);
    expect(screen.getByText('7')).toHaveStyle({ color: 'var(--success)' });
  });

  it('colours the value with the error tone', () => {
    render(<StatTile label="Errors" value="3" tone="error" />);
    expect(screen.getByText('3')).toHaveStyle({ color: 'var(--error)' });
  });

  it('colours the value with the warning tone', () => {
    render(<StatTile label="Stale" value="1" tone="warning" />);
    expect(screen.getByText('1')).toHaveStyle({ color: 'var(--warning)' });
  });

  it('uses the default strong colour when no tone is set', () => {
    render(<StatTile label="Visitors" value="42" />);
    expect(screen.getByText('42')).toHaveStyle({ color: 'var(--text-strong)' });
  });

  it('lets its grid or row decide the width (no fixed floor that overflows a 3-up grid at 360px)', () => {
    const { container } = render(<StatTile label="Visits" value="9" />);
    expect(container.firstElementChild).toHaveStyle({ minWidth: '0px' });
  });
});
