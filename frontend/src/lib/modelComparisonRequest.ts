export const MAX_MODEL_COMPARISON = 3;

export function normalizeModelComparisonIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_MODEL_COMPARISON);
}

export function readModelComparison(params: Pick<URLSearchParams, 'get' | 'getAll'>): string[] {
  return params.get('compare') === '1' ? normalizeModelComparisonIds(params.getAll('model')) : [];
}

export function appendModelComparison(params: URLSearchParams, ids: readonly string[]): URLSearchParams {
  const models = normalizeModelComparisonIds(ids);
  if (models.length < 2) return params;
  params.set('compare', '1');
  models.forEach((model) => params.append('model', model));
  return params;
}

export function modelComparisonCanvasHref(sessionId: string, ids: readonly string[]): string {
  const query = appendModelComparison(new URLSearchParams(), ids).toString();
  return `/create/${sessionId}${query ? `?${query}` : ''}`;
}
