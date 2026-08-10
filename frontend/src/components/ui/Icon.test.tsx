import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon, iconName } from './Icon';

describe('Icon', () => {
  it('normalizes legacy emoji and unicode glyphs into the shared icon language', () => {
    expect(iconName('🏠')).toBe('home');
    expect(iconName('📊')).toBe('insights');
    expect(iconName('⚙')).toBe('settings');
  });

  it('uses a professional neutral fallback instead of rendering an unknown glyph', () => {
    const { container } = render(<Icon source="🪄" data-testid="icon" />);
    expect(iconName('🪄')).toBe('apps');
    expect(screen.getByTestId('icon').tagName).toBe('svg');
    expect(container).not.toHaveTextContent('🪄');
  });

  it('preserves supplied brand artwork', () => {
    render(<Icon source={<span data-testid="brand-mark">B</span>} />);
    expect(screen.getByTestId('brand-mark')).toBeInTheDocument();
  });
});
