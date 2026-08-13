import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpecObjectBody } from './SpecObjectBody';
import type { CreationNodeData } from './types';

/**
 * The generic founder body. Rendered directly rather than through `CreationNode` so the
 * assertions are about THIS component and do not drag the whole canvas tree in.
 *
 * The global next-intl mock returns the key path (with interpolated values appended), so
 * a label asserts as `field.<name>` — which is exactly what we want to check: that the
 * component asks for the key the catalogs actually declare.
 */
const node = (data: Partial<CreationNodeData> & { kind: string }): CreationNodeData =>
  ({ title: 'Untitled', ...data } as CreationNodeData);

describe('SpecObjectBody', () => {
  it('renders nothing for a kind it does not spec', () => {
    const { container } = render(<SpecObjectBody data={node({ kind: 'dashboard' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * An empty founder card must SAY it is empty rather than draw placeholder rows.
   * Sample competitor coordinates are indistinguishable from researched ones at a
   * glance, and a founder acting on invented geography is worse than an empty card.
   */
  it('shows an explicit empty state rather than placeholder content', () => {
    render(<SpecObjectBody data={node({ kind: 'competitor', title: 'Acme' })} />);
    expect(screen.getByText(/founder\.empty creationCanvas/)).toBeInTheDocument();
    expect(screen.getByText('creationCanvas.founder.emptyHint')).toBeInTheDocument();
  });

  it('renders only the fields that carry content', () => {
    render(<SpecObjectBody data={node({ kind: 'competitor', title: 'Acme', headquarters: 'Tampa, FL' })} />);
    expect(screen.getByText('creationCanvas.founder.field.headquarters')).toBeInTheDocument();
    // Declared on the spec, absent from the data — must not render an empty row.
    expect(screen.queryByText('creationCanvas.founder.field.estimatedRevenue')).not.toBeInTheDocument();
  });

  it('renders chips for a string array', () => {
    render(<SpecObjectBody data={node({ kind: 'competitor', weaknesses: ['No Gulf Coast coverage', 'No SMB tier'] })} />);
    expect(screen.getByText('No Gulf Coast coverage')).toBeInTheDocument();
    expect(screen.getByText('No SMB tier')).toBeInTheDocument();
  });

  it('renders a titled list from {title, detail} entries', () => {
    render(<SpecObjectBody data={node({
      kind: 'customerSegment',
      pains: [{ title: 'Manual scheduling', detail: 'Six hours a week per branch.' }],
    })} />);
    expect(screen.getByText('Manual scheduling')).toBeInTheDocument();
    expect(screen.getByText('Six hours a week per branch.')).toBeInTheDocument();
  });

  it('renders a table with its declared columns', () => {
    render(<SpecObjectBody data={node({
      kind: 'competitor',
      locations: [{ name: 'HQ', city: 'Tampa', region: 'FL', lat: 27.95, lng: -82.45 }],
    })} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'creationCanvas.founder.column.city' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Tampa' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '27.95' })).toBeInTheDocument();
  });

  it('drops table rows that carry nothing', () => {
    render(<SpecObjectBody data={node({ kind: 'competitor', locations: [{}, { city: 'Tampa' }] })} />);
    // One data row, plus the header row.
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('renders a meter with an accessible label and a tone', () => {
    const { container } = render(<SpecObjectBody data={node({ kind: 'customerSegment', fitScore: 82 })} />);
    expect(screen.getByRole('img', { name: /founder\.meterLabel.*82/ })).toBeInTheDocument();
    expect(container.querySelector('[data-tone="good"]')).toBeTruthy();
  });

  it('clamps a meter to 0–100 and tones a low score as risk', () => {
    const { container } = render(<SpecObjectBody data={node({ kind: 'customerSegment', fitScore: -20 })} />);
    expect(container.querySelector('[data-tone="risk"]')).toBeTruthy();
  });

  /**
   * Not scored is not the same as scored zero. `Number('')` is 0, so stripping
   * non-digits out of "unknown" and parsing it drew a red zero bar and told the founder
   * the segment had been assessed and rejected.
   */
  it('omits a meter whose value cannot be read, rather than drawing a zero', () => {
    render(<SpecObjectBody data={node({ kind: 'customerSegment', fitScore: 'unknown', geography: ['Florida'] })} />);
    expect(screen.queryByRole('img', { name: /meterLabel/ })).not.toBeInTheDocument();
    // The rest of the card still renders — one unreadable field is not a blank object.
    expect(screen.getByText('Florida')).toBeInTheDocument();
  });

  it('still renders a genuine zero score', () => {
    render(<SpecObjectBody data={node({ kind: 'customerSegment', fitScore: 0 })} />);
    expect(screen.getByRole('img', { name: /meterLabel/ })).toBeInTheDocument();
  });

  it('leads with the stats', () => {
    const { container } = render(<SpecObjectBody data={node({
      kind: 'competitor', headquarters: 'Tampa, FL', positioning: 'The incumbent for mid-market.',
    })} />);
    const body = container.firstElementChild!;
    // The stat row is first, so the numbers a founder scans for are at the top of the card.
    expect(body.firstElementChild?.className).toMatch(/founderStatRow/);
  });

  /** A fetched-at is only useful as an age; an ISO string makes the reader do the maths. */
  it('renders a fetch instant as relative staleness', () => {
    render(<SpecObjectBody data={node({ kind: 'liveMetric', value: '4.5', fetchedAt: new Date().toISOString() })} />);
    expect(screen.getByText(/founder\.freshJustNow/)).toBeInTheDocument();
  });

  it('falls back to the raw value when a fetch instant is unparseable', () => {
    render(<SpecObjectBody data={node({ kind: 'liveMetric', fetchedAt: 'sometime' })} />);
    expect(screen.getByText('sometime')).toBeInTheDocument();
  });

  it('renders a verdict as its own callout', () => {
    const { container } = render(<SpecObjectBody data={node({ kind: 'battlecard', wedge: 'No Gulf Coast coverage' })} />);
    expect(container.querySelector('[class*="founderVerdict"]')).toBeTruthy();
    expect(screen.getByText('No Gulf Coast coverage')).toBeInTheDocument();
  });

  it('renders a number stat with thousands grouping', () => {
    render(<SpecObjectBody data={node({ kind: 'company', headcount: 1200 })} />);
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });
});
