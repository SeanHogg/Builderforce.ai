'use client';

import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar Component', () => {
  it('should handle null name without error', () => {
    expect(() => {
      render(<Avatar name={null} />);
    }).not.toThrow();
  });

  it('should handle undefined name without error', () => {
    expect(() => {
      render(<Avatar name={undefined} />);
    }).not.toThrow();
  });

  it('should render initials for empty string', () => {
    render(<Avatar name="" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('should generate correct color for name', () => {
    render(<Avatar name="John Doe" />);
    const avatar = screen.getByRole('button');
    expect(avatar).toHaveStyle(`background-color: #f4726e`);
  });
});