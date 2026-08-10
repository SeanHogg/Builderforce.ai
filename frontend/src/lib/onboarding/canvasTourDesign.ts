import type { CreationNodeData } from '@/components/creation-canvas/types';

export interface CanvasTourDesignStep {
  id: string;
  title: string;
  body: string;
  targetObjectId: string;
}

export interface CanvasTourDesign {
  version: number;
  minimumVisits: number;
  offerTitle: string;
  offerBody: string;
  startLabel: string;
  cancelLabel: string;
  blurBackground: boolean;
  escapeHatch: boolean;
  steps: CanvasTourDesignStep[];
}

const DEFAULT_STEPS: CanvasTourDesignStep[] = [
  { id: 'welcome', title: 'Orient the user', body: 'Explain the first important area and why it matters.', targetObjectId: '' },
  { id: 'action', title: 'Show the key action', body: 'Highlight the action that helps the user make progress.', targetObjectId: '' },
];

export function defaultCanvasTourDesign(): CanvasTourDesign {
  return {
    version: 1,
    minimumVisits: 1,
    offerTitle: 'Welcome — want a quick tour?',
    offerBody: 'Learn the essentials in a few short steps. You can leave at any time.',
    startLabel: 'Start tour',
    cancelLabel: 'Not now',
    blurBackground: true,
    escapeHatch: true,
    steps: DEFAULT_STEPS.map((step) => ({ ...step })),
  };
}

function text(value: unknown, fallback: string, limit = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) || fallback : fallback;
}

export function canvasTourDesignFromNode(data: CreationNodeData): CanvasTourDesign {
  const fallback = defaultCanvasTourDesign();
  const raw = data.tour && typeof data.tour === 'object' && !Array.isArray(data.tour)
    ? data.tour as Record<string, unknown>
    : {};
  const steps = Array.isArray(raw.steps) ? raw.steps.slice(0, 12).flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const step = value as Record<string, unknown>;
    return [{
      id: text(step.id, `step-${index + 1}`, 80),
      title: text(step.title, `Step ${index + 1}`, 160),
      body: text(step.body, '', 1_000),
      targetObjectId: text(step.targetObjectId, '', 120),
    }];
  }) : fallback.steps;
  return {
    version: Math.max(1, Math.min(999, Math.trunc(Number(raw.version) || fallback.version))),
    minimumVisits: Math.max(1, Math.min(20, Math.trunc(Number(raw.minimumVisits) || fallback.minimumVisits))),
    offerTitle: text(raw.offerTitle, fallback.offerTitle, 160),
    offerBody: text(raw.offerBody, fallback.offerBody, 1_000),
    startLabel: text(raw.startLabel, fallback.startLabel, 80),
    cancelLabel: text(raw.cancelLabel, fallback.cancelLabel, 80),
    blurBackground: raw.blurBackground !== false,
    // This is a product safety rule, not a design preference. Authored data may
    // request false, but every runtime receives an escape hatch regardless.
    escapeHatch: true,
    steps: steps.length ? steps : fallback.steps,
  };
}
