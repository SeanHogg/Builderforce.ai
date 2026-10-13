import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FILTER_FIELDS, filterFromQuery, type ReplayFilter } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsScopeProvider } from '@/components/insights/insightsScope';
import { ReplayFilterBar } from './ReplayFilterBar';
import { ReplayFilterSlot } from './ReplayFilterSlot';
import { FILTER_VALUE_EDITORS } from './filterValueEditors';
import { addClause } from './useReplayFilter';

/**
 * THE filter bar (PRD 33 §3.4): clauses are chips, "Add filter" lists every
 * registered field, the value editor comes from `FILTER_VALUE_EDITORS` by the
 * field's `valueKind`, and the scope's filter follows the address both ways.
 * Copy is the passthrough key under the global next-intl mock.
 */

const devicePhone: ReplayFilter = { all: [{ field: 'device', op: 'eq', value: 'phone' }] };

function addFilter(field: string) {
  fireEvent.click(screen.getByRole('button', { name: /replay\.filter\.add/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: `replay.filter.field.${field}` }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReplayFilterBar', () => {
  it('lists every registered field in the add menu', () => {
    render(<ReplayFilterBar filter={{ all: [] }} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /replay\.filter\.add/ }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(FILTER_FIELDS.length);
  });

  it('adds a clause through the enum editor', () => {
    const onChange = vi.fn();
    render(<ReplayFilterBar filter={{ all: [] }} onChange={onChange} />);
    addFilter('device');
    const apply = screen.getByRole('button', { name: 'replay.filter.apply' });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'replay.filter.valueAria' }), { target: { value: 'phone' } });
    fireEvent.click(apply);
    expect(onChange).toHaveBeenCalledWith(devicePhone);
  });

  it('picks the editor from the registry by value kind (a duration is typed in seconds)', () => {
    for (const field of FILTER_FIELDS) expect(FILTER_VALUE_EDITORS[field.valueKind]).toBeDefined();
    const onChange = vi.fn();
    render(<ReplayFilterBar filter={{ all: [] }} onChange={onChange} />);
    addFilter('durationMs');
    expect(screen.getByText('replay.filter.unit.seconds')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'replay.filter.valueAria' }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'replay.filter.apply' }));
    expect(onChange).toHaveBeenCalledWith({ all: [{ field: 'durationMs', op: 'gte', value: 30_000 }] });
  });

  it('offers the site’s values as suggestions', () => {
    const { container } = render(
      <ReplayFilterBar filter={{ all: [] }} onChange={() => {}} options={[{ field: 'browser', values: [{ value: 'Chrome', count: 40 }] }]} />,
    );
    addFilter('browser');
    expect(container.querySelector('datalist option')?.getAttribute('value')).toBe('Chrome');
  });

  it('removes a clause from its chip', () => {
    const onChange = vi.fn();
    render(<ReplayFilterBar filter={devicePhone} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /replay\.filter\.remove/ }));
    expect(onChange).toHaveBeenCalledWith({ all: [] });
  });

  it('replaces a clause on the same field and op instead of stacking it', () => {
    expect(addClause(devicePhone, { field: 'device', op: 'eq', value: 'tablet' })).toEqual({
      all: [{ field: 'device', op: 'eq', value: 'tablet' }],
    });
  });
});

describe('ReplayFilterSlot (URL sync)', () => {
  beforeEach(() => {
    vi.spyOn(replayApi, 'filterOptions').mockResolvedValue([]);
    vi.spyOn(replayApi, 'listSegments').mockResolvedValue([]);
  });

  it('starts from the address and writes every change back, keeping the panel', async () => {
    window.history.replaceState({}, '', '/apps/insights?panel=issues&f.browser.eq=Chrome');
    render(
      <InsightsScopeProvider siteId="site-1">
        <ReplayFilterSlot />
      </InsightsScopeProvider>,
    );
    expect(await screen.findByText(/replay\.filter\.field\.browser replay\.filter\.op\.eq Chrome/)).toBeInTheDocument();
    expect(replayApi.filterOptions).toHaveBeenCalledWith('site-1', { days: 30 });

    addFilter('device');
    fireEvent.change(screen.getByRole('combobox', { name: 'replay.filter.valueAria' }), { target: { value: 'phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'replay.filter.apply' }));

    const params = new URLSearchParams(window.location.search);
    expect(params.get('panel')).toBe('issues');
    expect(filterFromQuery(params)).toEqual({
      all: [{ field: 'browser', op: 'eq', value: 'Chrome' }, { field: 'device', op: 'eq', value: 'phone' }],
    });

    fireEvent.click(screen.getAllByRole('button', { name: /replay\.filter\.remove/ })[0]!);
    expect(filterFromQuery(window.location.search)).toEqual(devicePhone);
  });

  it('follows Back/Forward to a different filter', async () => {
    window.history.replaceState({}, '', '/apps/insights');
    render(
      <InsightsScopeProvider siteId="site-1">
        <ReplayFilterSlot />
      </InsightsScopeProvider>,
    );
    window.history.replaceState({}, '', '/apps/insights?f.device.eq=phone');
    fireEvent.popState(window);
    expect(await screen.findByText(/replay\.filter\.field\.device replay\.filter\.op\.eq replay\.filter\.value\.phone/)).toBeInTheDocument();
  });
});
