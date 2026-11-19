import { describe, expect, it } from 'vitest';
import { getComponent } from '@/components/widgets/registry';
import { SAAS_COMPONENTS } from './saasWidgets';
import { AI_COMPONENTS } from './aiWidgets';

/** The ids the API presets name (PRD 25 Slice B5) must resolve through the registry. */
const IDS = [
  'growth.nrr',
  'growth.grr',
  'growth.cac-payback',
  'growth.ltv-cac',
  'growth.ltv-tranches',
  'ai.inference-margin',
  'ai.inference-efficiency',
];

describe('SaaS and AI-native widgets', () => {
  it('registers exactly the seven ids the API presets name', () => {
    expect([...SAAS_COMPONENTS, ...AI_COMPONENTS].map((c) => c.id).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS)('%s resolves through the widget registry', (id) => {
    expect(getComponent(id)).toBeDefined();
  });
});
