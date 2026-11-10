import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AnalyzePanel, categoryKey, severityKey } from './KnowledgeAnalyzePanel';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

const analyze = vi.hoisted(() => vi.fn());
vi.mock('@/lib/knowledgeApi', () => ({ knowledgeApi: { analyze } }));

describe('AnalyzePanel finding labels', () => {
  it('maps known model values to their keys', () => {
    expect(severityKey('high')).toBe('severity_high');
    expect(categoryKey('gap')).toBe('category_gap');
  });

  it('regression: an unknown model severity/category uses the _other key, never a raw key', async () => {
    analyze.mockResolvedValueOnce({
      summary: '',
      improvedFlow: '',
      findings: [{ severity: 'critical', category: 'compliance', issue: 'Something', recommendation: '' }],
    });
    render(<AnalyzePanel docId="d1" getBlocks={() => []} onApplyFlow={() => {}} />);
    fireEvent.click(screen.getByText(/knowledge\.analyzeTitle/));
    fireEvent.click(screen.getByText('knowledge.analyzeRun'));
    expect(await screen.findByText('knowledge.severity_other')).toBeTruthy();
    expect(screen.getByText('knowledge.category_other')).toBeTruthy();
    expect(screen.queryByText('knowledge.severity_critical')).toBeNull();
    expect(screen.queryByText('knowledge.category_compliance')).toBeNull();
  });

  it('every fallback key exists in all five catalogs', () => {
    for (const catalog of [en, zh, es, fr, de] as unknown as Array<{ knowledge: Record<string, string> }>) {
      expect(catalog.knowledge.severity_other).toBeTruthy();
      expect(catalog.knowledge.category_other).toBeTruthy();
    }
  });
});
