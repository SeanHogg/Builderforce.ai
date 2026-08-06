import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetCarousel } from './MeetCarousel';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

const rawMessages: Record<string, unknown> = {
  'home.createCanvas.features': [{ title: 'Intent', desc: 'Start clearly' }],
  'home.createCanvas.objects': [{ title: 'Workflow', meta: 'Draft to publish' }],
  'home.createCanvas.flow': ['Prompt', 'Outcome'],
  'evermind.architecture.pillars': [{ title: 'Memory', desc: 'Keeps context current' }],
  'evermind.edges.items': [{ label: 'Currency', desc: 'Current knowledge' }],
  'home.pillars': [{ title: 'Review', desc: 'Keep control' }],
  'home.roles': [{ role: 'Team', desc: 'See the right signals' }],
};

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const translate = (key: string) => key;
    translate.raw = (key: string) => rawMessages[key] ?? [];
    return translate;
  },
}));

describe('MeetCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => vi.useRealTimers());

  it('rotates every seven seconds and pauses while the visitor interacts', () => {
    const { container } = render(<MeetCarousel />);
    const carousel = container.querySelector('.meet-carousel') as HTMLElement;

    expect(screen.getByText('01 / 03')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText('02 / 03')).toBeInTheDocument();

    fireEvent.mouseEnter(carousel);
    act(() => vi.advanceTimersByTime(14000));
    expect(screen.getByText('02 / 03')).toBeInTheDocument();

    fireEvent.mouseLeave(carousel);
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText('03 / 03')).toBeInTheDocument();
  });

  it('supports arrows and an explicit autoplay pause control', () => {
    render(<MeetCarousel />);

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByText('02 / 03')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pause automatic slide rotation' }));
    act(() => vi.advanceTimersByTime(14000));
    expect(screen.getByText('02 / 03')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume automatic slide rotation' })).toBeInTheDocument();
  });
});
