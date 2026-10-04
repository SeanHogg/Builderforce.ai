

export function scoreAgentTestResponse(response: string, expected: string): { passed: boolean | null; matched: string[]; missing: string[] } {
  const criteria = expected.split(/[\n,;]+/).map((item) => item.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 20);
  if (!criteria.length) return { passed: null, matched: [], missing: [] };
  const haystack = response.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const matches = (criterion: string) => {
    const words = criterion.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2) ?? [];
    return words.length > 0 && words.filter((word) => haystack.includes(word)).length >= Math.ceil(words.length * 0.6);
  };
  const matched = criteria.filter(matches);
  const missing = criteria.filter((criterion) => !matches(criterion));
  return { passed: missing.length === 0, matched, missing };
}
