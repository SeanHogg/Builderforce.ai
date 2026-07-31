import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.hoisted(() => vi.fn(async () => ({})));
const apiRequestText = vi.hoisted(() => vi.fn(async () => ''));

vi.mock('./apiClient', () => ({ apiRequest, apiRequestText }));

import { recommendationsApi } from './recommendationsApi';
import { benchmarkingApi } from './benchmarkingApi';
import { empInsightsApi } from './empInsightsApi';

describe('delivery insight API project scope', () => {
  beforeEach(() => {
    apiRequest.mockClear();
    apiRequestText.mockClear();
  });

  it('adds projectId to SPACE and industry benchmarking reads', async () => {
    await recommendationsApi.space(30, 42);
    await benchmarkingApi.get(90, 42);

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/insights/space?days=30&projectId=42');
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/insights/benchmarking?days=90&projectId=42');
  });

  it('adds projectId to cross-team, delay, and export reads', async () => {
    await empInsightsApi.crossTeam(30, 42);
    await empInsightsApi.delayTaxonomy(90, 42);
    await empInsightsApi.exportDataset('dora', 'csv', 30, 42);

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/insights/benchmarking/cross-team?days=30&projectId=42');
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/insights/delay-taxonomy?days=90&projectId=42');
    expect(apiRequestText).toHaveBeenCalledWith('/api/insights/export?dataset=dora&format=csv&days=30&projectId=42');
  });

  it('preserves tenant-wide URLs when All Projects is selected', async () => {
    await recommendationsApi.space(30, null);
    await benchmarkingApi.get(30, null);

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/insights/space?days=30');
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/insights/benchmarking?days=30');
  });
});
