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

    fireEvent.click(screen.getByRole('button', { name: 'home.carousel.next' }));
    expect(screen.getByText('02 / 03')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'home.carousel.pause' }));
    act(() => vi.advanceTimersByTime(14000));
    expect(screen.getByText('02 / 03')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'home.carousel.resume' })).toBeInTheDocument();
  });

  it('shows only the active slide, so a short slide never inherits a tall one', () => {
    const { container } = render(<MeetCarousel />);
    const active = () => container.querySelectorAll('.meet-slide.is-active');

    expect(active()).toHaveLength(1);
    expect(active()[0].id).toBe('meet-panel-0');
    expect(container.querySelector('#meet-panel-1')?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: /home.pillarsHeading/ }));
    expect(active()).toHaveLength(1);
    expect(active()[0].id).toBe('meet-panel-2');
  });

  it('styles its own slides — the Create slide carries the panel frame', () => {
    const { container } = render(<MeetCarousel />);

    // Regression: these once relied on `.lp-create*` rules that lived in the
    // landing page and were deleted with the old hero, leaving the slide bare.
    expect(container.querySelector('.meet-slide.is-active .meet-panel')).toBeInTheDocument();
    expect(container.querySelector('.meet-create-board')).toBeInTheDocument();
    expect(container.querySelector('.meet-create-feature')).toBeInTheDocument();
    expect(container.querySelector('.meet-create-flow')).toBeInTheDocument();
  });
});
