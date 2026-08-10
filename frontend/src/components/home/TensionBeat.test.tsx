import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TensionBeat } from './TensionBeat';

const messages: Record<string, unknown> = {
  'home.tension.fragments': ['Doc', 'Chat', 'Board', 'Editor', 'Spreadsheet'],
  'home.tension.ideaLabel': 'IDEA',
  'home.tension.realLabel': 'REAL',
  'home.tension.realDefinition': 'Live in production. Ready to use.',
  'home.tension.switchCost': 'Time lost · context repeated',
  'home.steps': [
    { title: 'Bring the idea', desc: 'Start with the result.' },
    { title: 'Shape it in one place', desc: 'Keep the context together.' },
    { title: 'Make it real', desc: 'Put it into production.' },
  ],
};

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const translate = (key: string) => String(messages[key] ?? key);
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
    expect(section).toHaveTextContent('IDEA');
    expect(section).toHaveTextContent('REAL');
    expect(section).toHaveTextContent('Time lost · context repeated');
    expect(section).toHaveTextContent('Live in production. Ready to use.');
  });
});
