import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

// The drawer is exercised for what the factory hands it — open state, title, width,
// tabs and the tab callback — not for its own chrome.
vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ open, title, width, widthStorageKey, tabs, activeTabId, onTabChange, children }: {
    open: boolean;
    title?: string;
    width?: string;
    widthStorageKey?: string;
    tabs?: { id: string; label: string }[];
    activeTabId?: string;
    onTabChange?: (id: string) => void;
    children?: ReactNode;
  }) => (open ? (
    <section aria-label="drawer" data-width={width} data-storage={widthStorageKey}>
      <h2>{title}</h2>
      {tabs?.map((tab) => (
        <button key={tab.id} type="button" aria-pressed={tab.id === activeTabId} onClick={() => onTabChange?.(tab.id)}>
          {tab.label}
        </button>
      ))}
      <button type="button" onClick={() => onTabChange?.('not-a-panel')}>stray</button>
      {children}
    </section>
  ) : null),
}));

vi.mock('@/components/RoleGate', () => ({
  RoleGate: ({ capability, children }: { capability: string; children: ReactNode }) => (
    <div data-capability={capability}>{children}</div>
  ),
}));

import { createPanelProvider } from './createPanelProvider';

type Id = 'alpha' | 'beta';

const kit = createPanelProvider<Id>({
  name: 'TestPanel',
  namespace: 'insights.testhub',
  panels: [
    { id: 'alpha', titleKey: 'panel.alpha', descKey: 'panel.alphaDesc', capability: 'insights.delivery', render: () => <p>alpha lens</p> },
    { id: 'beta', titleKey: 'panel.beta', descKey: 'panel.betaDesc', capability: 'insights.finance', width: 'narrow', render: () => <p>beta lens</p> },
  ],
  widthStorageKey: 'test-insights',
  defaultWidth: 'wide',
});

function Opener({ id }: { id: Id }) {
  const panel = kit.usePanel();
  return <button type="button" onClick={() => panel.open(id)}>open {id}</button>;
}

describe('createPanelProvider', () => {
  it('renders nothing until a panel is opened, then the lens behind its RoleGate', () => {
    render(<kit.Provider><Opener id="alpha" /></kit.Provider>);
    expect(screen.queryByLabelText('drawer')).toBeNull();

    act(() => screen.getByText('open alpha').click());

    const drawer = screen.getByLabelText('drawer');
    expect(screen.getByRole('heading')).toHaveTextContent('insights.testhub.panel.alpha');
    expect(screen.getByText('insights.testhub.panel.alphaDesc')).toBeInTheDocument();
    expect(screen.getByText('alpha lens').closest('[data-capability]')).toHaveAttribute('data-capability', 'insights.delivery');
    expect(drawer).toHaveAttribute('data-storage', 'test-insights');
    // A panel without its own width takes the factory default.
    expect(drawer).toHaveAttribute('data-width', 'wide');
  });

  it('tabs across every panel in registry order and ignores a stray tab id', () => {
    render(<kit.Provider><Opener id="alpha" /></kit.Provider>);
    act(() => screen.getByText('open alpha').click());

    const tabLabels = screen.getAllByRole('button', { pressed: undefined })
      .map((b) => b.textContent)
      .filter((label) => label?.startsWith('insights.'));
    expect(tabLabels).toEqual(['insights.testhub.panel.alpha', 'insights.testhub.panel.beta']);

    act(() => screen.getByText('insights.testhub.panel.beta').click());
    expect(screen.getByText('beta lens')).toBeInTheDocument();
    expect(screen.getByLabelText('drawer')).toHaveAttribute('data-width', 'narrow');

    act(() => screen.getByText('stray').click());
    expect(screen.getByText('beta lens')).toBeInTheDocument();
  });

  it('exposes open/close/active through the hook, with a stable api between renders', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <kit.Provider>{children}</kit.Provider>;
    const { result, rerender } = renderHook(() => kit.usePanel(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);

    act(() => result.current.open('beta'));
    expect(result.current.active).toBe('beta');
    act(() => result.current.close());
    expect(result.current.active).toBeNull();
  });

  it('throws outside the provider, while the optional hook returns null', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => kit.usePanel())).toThrow('useTestPanel must be used within a TestPanelProvider');
    spy.mockRestore();
    expect(renderHook(() => kit.useOptionalPanel()).result.current).toBeNull();
  });
});
