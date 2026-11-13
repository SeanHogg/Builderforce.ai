import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import React from 'react';
import DataTable from './DataTable';

// next-intl is globally mocked in src/test/setup.ts: `t('key', values)` returns
// `common.pagination.<key> <space-joined values>` and the provider is inert. So
// these tests assert on the MOCK's deterministic output (key + values), not on
// formatted English copy.
type Row = { id: number; name: string };

const columns: import('./DataTable').DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'id', header: 'ID', render: (row) => row.id, numeric: true },
];

function renderTable(overrides: Partial<import('./DataTable').DataTableProps<Row>> = {}) {
  const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <DataTable
        rows={rows}
        columns={columns}
        page={1}
        onPageChange={onPageChange}
        pageSize={50}
        onPageSizeChange={onPageSizeChange}
        {...(overrides as object)}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onPageChange, onPageSizeChange, rows };
}

describe('DataTable', () => {
  it('renders the header cells and only the current page of rows', () => {
    renderTable();
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('ID')).toBeTruthy();
    expect(screen.getByText('Row 50')).toBeTruthy();
    expect(screen.queryByText('Row 51')).toBeNull();
    expect(screen.getByText('common.pagination.pageRangeOf 1 50 120')).toBeTruthy();
  });

  it('clamps an out-of-range page to the last page', () => {
    renderTable({ page: 99 });
    expect(screen.getByText('Row 120')).toBeTruthy();
    expect(screen.getByText('common.pagination.pageRangeOf 101 120 120')).toBeTruthy();
  });

  it('shows the empty message (as the raw key) and no pager when there are no rows', () => {
    renderTable({ rows: [] });
    expect(screen.getByText('common.pagination.noResults')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('reports per-page changes and resets to page 1', () => {
    const { onPageSizeChange, onPageChange } = renderTable();
    const select = screen.getByLabelText('common.pagination.perPage');
    fireEvent.change(select, { target: { value: '200' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(200);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('lets renderRow take over the whole row while the footer still works', () => {
    renderTable({
      renderRow: (row) => (
        <tr data-testid={`custom-${row.id}`}>
          <td colSpan={2}>{row.name}</td>
        </tr>
      ),
    });
    expect(screen.getByTestId('custom-50')).toBeTruthy();
    expect(screen.queryByTestId('custom-51')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'common.pagination.label' })).toBeTruthy();
  });
});
