import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import React from 'react';
import DataList from './DataList';

// next-intl is globally mocked in src/test/setup.ts: `t('key', values)` returns
// `common.pagination.<key> <space-joined values>` and the provider is inert. So
// these tests assert on the MOCK's deterministic output (key + values), not on
// formatted English copy. See setup.ts for why interpolation is preserved.
type Row = { id: number; name: string };

function renderList(overrides: Partial<import('./DataList').DataListProps<Row>> = {}) {
  const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <DataList
        rows={rows}
        renderRow={(row) => <div data-testid={`row-${row.id}`}>{row.name}</div>}
        page={1}
        onPageChange={onPageChange}
        pageSize={50}
        onPageSizeChange={onPageSizeChange}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onPageChange, onPageSizeChange, rows };
}

describe('DataList', () => {
  it('renders only the current page (50 of 120)', () => {
    renderList();
    expect(screen.getByTestId('row-50')).toBeTruthy();
    expect(screen.queryByTestId('row-51')).toBeNull();
    // Mock t: key + space-joined values → "common.pagination.pageRangeOf 1 50 120"
    expect(screen.getByText('common.pagination.pageRangeOf 1 50 120')).toBeTruthy();
  });

  it('renders the pagination control with the right page count', () => {
    renderList();
    // aria-label comes from t('label') → "common.pagination.label"; the page
    // buttons are labelled t('pageN', {n}) → "common.pagination.pageN 3".
    expect(screen.getByRole('navigation', { name: 'common.pagination.label' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common.pagination.pageN 3' })).toBeTruthy();
  });

  it('renders the per-page select with 50/100/200 and reports changes + resets to page 1', () => {
    const { onPageSizeChange, onPageChange } = renderList();
    const select = screen.getByLabelText('common.pagination.perPage');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['50', '100', '200']);
    fireEvent.change(select, { target: { value: '100' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('shows the empty message (as the raw key) and no pager when there are no rows', () => {
    renderList({ rows: [] });
    expect(screen.getByText('common.pagination.noResults')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('renders header content above the body', () => {
    renderList({ header: <div data-testid="list-header">filters</div> });
    expect(screen.getByTestId('list-header')).toBeTruthy();
  });

  it('renders a single count (not a range) when everything fits on one page', () => {
    renderList({ rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `R${i}` })) });
    expect(screen.getByText('common.pagination.resultCount 30')).toBeTruthy();
  });

  it('lets renderBody take over the whole body while the footer still paginates', () => {
    renderList({
      renderBody: (pageRows: Row[]) => (
        <div data-testid="custom-body">
          {pageRows.map((r) => (
            <span key={r.id}>{r.name}</span>
          ))}
        </div>
      ),
    });
    const body = screen.getByTestId('custom-body');
    expect(body.querySelectorAll('span')).toHaveLength(50);
    expect(screen.getByRole('navigation', { name: 'common.pagination.label' })).toBeTruthy();
  });
});
