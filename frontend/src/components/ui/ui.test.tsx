import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, Button, ButtonLink, Surface, TextField } from './index';

describe('Builderforce UI primitives', () => {
  it('applies one canonical button contract to buttons and links', () => {
    render(
      <>
        <Button variant="primary" size="lg" loading>Save</Button>
        <ButtonLink href="/create" variant="secondary">Create</ButtonLink>
      </>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('ui-button--primary', 'ui-button--lg');
    expect(screen.getByRole('link', { name: 'Create' })).toHaveClass('ui-button--secondary');
  });

  it('wires field errors to the native control', () => {
    render(<TextField id="name" label="Name" error="Required" />);

    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'name-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('keeps surface and status variants explicit', () => {
    render(<Surface tone="raised"><Badge tone="success" dot>Live</Badge></Surface>);
    expect(screen.getByText('Live')).toHaveClass('ui-badge--success');
    expect(screen.getByText('Live').parentElement).toHaveClass('ui-surface--raised');
  });
});
