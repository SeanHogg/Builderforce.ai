import { describe, expect, it } from 'vitest';
import { authoredWebsiteProblem } from '@builderforce/creation-canvas-contract';
import { primaryRealizationDoc, realizationCanvasLanding, type RealizationView } from './canvasRealize';

function view(over: Partial<RealizationView> = {}): RealizationView {
  return {
    id: 'rlz_1',
    targetKey: 'phone-line',
    title: 'Night-shift intake',
    status: 'planned',
    liveUrl: null,
    plan: {
      blueprintKey: 'phone-line',
      blueprintName: 'Phone line',
      summary: 'A real number that answers in the product voice.',
      files: {
        'phone.html': '<html></html>',
        'phone-line/runbook.md': '# Runbook\n\nWiring it up…',
      },
      tasks: [],
      requiredConnectors: [],
      requiredSecrets: [],
      successCriteria: ['Half of all questions answered without a human.'],
    },
    ...over,
  };
}

describe('primaryRealizationDoc', () => {
  it('picks the one generated markdown charter over the HTML consoles beside it', () => {
    const doc = primaryRealizationDoc({
      'phone.html': '<html></html>',
      'phone-line/runbook.md': '# Runbook\n\nWiring it up…',
    });
    expect(doc).toEqual({ path: 'phone-line/runbook.md', content: '# Runbook\n\nWiring it up…' });
  });

  it('returns null when the target produced no markdown doc', () => {
    expect(primaryRealizationDoc({ 'index.html': '<html></html>' })).toBeNull();
  });

  it('returns null for an empty file map', () => {
    expect(primaryRealizationDoc({})).toBeNull();
  });
});

describe('realizationCanvasLanding', () => {
  it('lands a publishable website plus the markdown charter, never a workflow', () => {
    const landing = realizationCanvasLanding(view());
    expect(landing).not.toHaveProperty('error');
    if ('error' in landing) return;
    expect(landing.delivery).toEqual({
      canvasKind: 'website',
      deliveryAction: 'publish',
      outcomeAction: 'artifact.publish',
    });
    expect(authoredWebsiteProblem(landing.website)).toBeNull();
    expect(landing.website.title).toBe('Night-shift intake');
    expect(landing.website.status).toBe('Plan ready');
    expect(landing.document).toMatchObject({
      title: 'Night-shift intake — Phone line',
      content: '# Runbook\n\nWiring it up…',
      status: 'Plan ready',
    });
  });

  it('refuses an unknown target rather than landing a titled shell', () => {
    expect(realizationCanvasLanding(view({ targetKey: 'not-a-target' }))).toEqual({
      error: 'No canvas delivery adapter for "not-a-target". Call canvas_list_realization_targets and name a tested proof form.',
    });
  });

  it('still lands the website when the target produced no markdown doc', () => {
    const landing = realizationCanvasLanding(view({
      plan: {
        ...view().plan,
        files: { 'index.html': '<html></html>' },
      },
    }));
    expect(landing).not.toHaveProperty('error');
    if ('error' in landing) return;
    expect(landing.document).toBeNull();
    expect(authoredWebsiteProblem(landing.website)).toBeNull();
  });
});
