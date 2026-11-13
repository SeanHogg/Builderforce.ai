import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import React from 'react';
import DataList from './DataList';

const messages = {
  common: {
    pagination: {
      label: 'Pagination',
      prev: 'Previous page',
      next: 'Next page',
      pageOf: 'Page {page} of {pages}',
      pageN: 'Page {n}',
      perPage: 'Results per page',
      noResults: 'No results',
      pageRangeOf: '{start}–{end} of {total, plural, one {# result} other {# results}}',
      resultCount: '{n, plural, =0 {No results} one {# result} other {# results}}',
    },
  },
};

type Row = { id: number; name: string };

function renderList(overrides: Partial<import('./DataList').DataListProps<Row>> = {}) {
  const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={messages}>
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
    expect(screen.getByText('1–50 of 120 results')).toBeTruthy();
  });

  it('renders the pagination control with the right page count', () => {
    renderList();
    // 120 rows / 50 per page = 3 pages
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Page 3' })).toBeTruthy();
  });

  it('renders the per-page select with 50/100/200 and reports changes + resets to page 1', () => {
    const { onPageSizeChange, onPageChange } = renderList();
    const select = screen.getByLabelText('Results per page');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['50', '100', '200']);
    fireEvent.change(select, { target: { value: '100' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('shows the empty message when there are no rows and no footer', () => {
    renderList({ rows: [] });
    expect(screen.getByText('No results')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('renders header content above the body', () => {
    renderList({ header: <div data-testid="list-header">filters</div> });
    expect(screen.getByTestId('list-header')).toBeTruthy();
  });

  it('renders a single count (not a range) when everything fits on one page', () => {
    renderList({ rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `R${i}` })) });
    expect(screen.getByText('30 results')).toBeTruthy();
    expect(screen.queryByText(/–/)).toBeNull();
  });
});
