import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TensionBeat } from './TensionBeat';

const messages: Record<string, unknown> = {
  'home.tension.fragments': ['Doc', 'Chat', 'Board', 'Editor', 'Spreadsheet'],
  'home.steps': [
    { title: 'Describe the outcome', desc: 'Start with the result.' },
    { title: 'Create and connect', desc: 'Keep the context together.' },
    { title: 'Review and deliver', desc: 'Ship with control.' },
  ],
};

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const translate = (key: string) => key;
    translate.raw = (key: string) => messages[key] ?? [];
    translate.rich = (key: string) => key;
    return translate;
  },
}));

describe('TensionBeat', () => {
  it('keeps the problem and the three-step answer in one section', () => {
    const { container } = render(<TensionBeat />);
    const section = container.querySelector('#the-problem');

    expect(section).toContainElement(screen.getByRole('heading', { name: 'home.tension.heading' }));
    expect(section).toContainElement(screen.getByRole('heading', { name: 'home.stepsHeading' }));
    expect(section?.querySelector('#how-it-works')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
