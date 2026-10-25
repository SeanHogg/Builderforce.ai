import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextMeter } from './ContextMeter';
import { DEFAULT_COMPOSER_LABELS } from './labels';

const render = (usage: Parameters<typeof ContextMeter>[0]['usage']) =>
  renderToStaticMarkup(<ContextMeter usage={usage} labels={DEFAULT_COMPOSER_LABELS} locale="en-US" />);

describe('<ContextMeter>', () => {
  it('renders nothing before any turn reported usage', () => {
    expect(render(null)).toBe('');
  });

  it('shows the percentage of the window and says older history auto-compacts', () => {
    const html = render({ promptTokens: 44_781, contextWindow: 200_000 });
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="22"');
    expect(html).toContain('>22%<');
    expect(html).toContain('44.8K of 200K tokens');
    expect(html).toContain('auto-compacted');
    expect(html).not.toContain('bf-ctx-meter--high');
  });

  it('warns as the window fills and caps at 100%', () => {
    expect(render({ promptTokens: 150_000, contextWindow: 200_000 })).toContain('bf-ctx-meter--high');
    const over = render({ promptTokens: 250_000, contextWindow: 200_000 });
    expect(over).toContain('bf-ctx-meter--full');
    expect(over).toContain('>100%<');
  });

  it('shows the token count alone when the window is unknown', () => {
    const html = render({ promptTokens: 44_781 });
    expect(html).not.toContain('role="meter"');
    expect(html).toContain('>44.8K<');
  });
});
