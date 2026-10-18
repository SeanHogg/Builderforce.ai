import { fireEvent, render, screen } from '@testing-library/react';
import en from '@/i18n/messages/en.json';
import de from '@/i18n/messages/de.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import zh from '@/i18n/messages/zh.json';
import { describe, expect, it, vi } from 'vitest';
import { CodeAuditVisualizer, CODE_AUDIT_KEYS } from './CodeAuditVisualizer';
import type { CodeAnalysisSnapshot } from '@builderforce/agent-tools';
const baseline: CodeAnalysisSnapshot = { version: 1, id: 'before', capturedAt: '2026-10-18T12:00:00.000Z', source: { commit: 'abc', branch: 'main', dirty: false },
  tools: ['dependency-cruiser', 'jscpd', 'knip'].map((name) => ({ name, version: '1', status: 'complete' })), nodes: ['src/a.ts', 'src/b.ts'],
  edges: [{ from: 'src/a.ts', to: 'src/b.ts', circular: true }],
  issues: [{ id: 'clone', kind: 'duplicate', locations: [{ path: 'src/a.ts', startLine: 3, endLine: 8 }, { path: 'src/b.ts', startLine: 5, endLine: 10 }], snippet: 'duplicated implementation' }] };

describe('code audit visualizer', () => {
  it('shows real duplicate ranges and opens the selected source location', () => {
    const open = vi.fn(); render(<CodeAuditVisualizer analysis={{ current: baseline }} openSource={open} />);
    expect(screen.getByRole('button', { name: 'codeAudit.before' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'codeAudit.duplicates' }));
    expect(screen.getByText('duplicated implementation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts:3–8' }));
    expect(open).toHaveBeenCalledWith({ path: 'src/a.ts', startLine: 3, endLine: 8 });
  });
  it('shows measured before/after changes and flags incomplete comparisons', () => {
    const current = { ...baseline, id: 'after', issues: [] };
    const { rerender } = render(<CodeAuditVisualizer analysis={{ current, baseline }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'codeAudit.comparison' }));
    expect(screen.getByText('duplicated implementation')).toBeInTheDocument();
    rerender(<CodeAuditVisualizer analysis={{ current: { ...current, tools: current.tools.map((t) => ({ ...t, status: 'failed' })) }, baseline }} />);
    expect(screen.queryByText('duplicated implementation')).not.toBeInTheDocument();
    expect(screen.getAllByText('codeAudit.incomparable').length).toBeGreaterThan(0);
  });
  it.each([['en', en], ['de', de], ['es', es], ['fr', fr], ['zh', zh]] as const)('resolves every visualizer key in %s', (locale, catalog) => {
    for (const key of CODE_AUDIT_KEYS) expect(catalog.codeAudit[key], `${locale}: ${key}`).toBeTruthy();
  });
});
