/**
 * The `/api/templates` client, and the types the wizard renders from.
 *
 * These mirror the server's `domain/guidedSetup` and `domain/template` contracts.
 * This repo has no shared package, so the duplication is the same one
 * `builderforceApi.ts` already carries for `Workflow` / `WorkflowTask` — kept
 * deliberately thin, and kept honest by the fact that the server sends the
 * RESOLVED plan (step + verdict together) rather than a manifest the client
 * would have to re-interpret.
 */

import { apiRequest } from '../apiClient';

export type GuidedFieldType = 'text' | 'multiline' | 'email' | 'url' | 'number' | 'secret';
export type GuidedResourceKind = 'project' | 'agent' | 'workflow';
export type GuidedStepKind = 'connect' | 'field' | 'choice' | 'resource' | 'schedule' | 'toggle';

export interface ChoiceOption { value: string; label: string; help?: string }
export interface ScheduleAnswer { cron: string; timezone: string }
export type GuidedAnswer = string | string[] | number | boolean | ScheduleAnswer | null;
export type GuidedAnswers = Record<string, GuidedAnswer>;

export interface GuidedStep {
  id: string;
  kind: GuidedStepKind;
  title: string;
  help?: string;
  required: boolean;
  // connect
  connector?: string;
  why?: string;
  // field
  fieldType?: GuidedFieldType;
  placeholder?: string;
  min?: number;
  max?: number;
  // choice
  options?: ChoiceOption[];
  multiple?: boolean;
  // resource
  resource?: GuidedResourceKind;
  allowCreate?: boolean;
  // schedule
  defaultCron?: string;
  defaultTimezone?: string;
  // toggle
  default?: boolean | string | number;
}

export interface ResolvedGuidedStep {
  step: GuidedStep;
  satisfied: boolean;
  error: string | null;
  value: GuidedAnswer;
  options?: ChoiceOption[];
}

export interface GuidedPlan {
  steps: ResolvedGuidedStep[];
  complete: boolean;
  blockedBy: string[];
  missingConnectors: string[];
}

export interface TemplateSummary {
  key: string;
  name: string;
  summary: string;
  category: string;
  icon: string;
  tags: string[];
  origin: 'builtin' | 'tenant' | 'marketplace';
  connectors: string[];
  connectedCount: number;
  stepCount: number;
  outputKinds: string[];
  installCount: number;
  priceCents: number | null;
  currency: string | null;
  publisherRef: string | null;
}

export interface TemplateDetail {
  key: string;
  name: string;
  summary: string;
  description?: string;
  category: string;
  icon: string;
  tags: string[];
  requiredConnectors: Array<{ key: string; label: string; why: string }>;
  requiredSecrets: Array<{ name: string; label: string; where: string }>;
  steps: GuidedStep[];
  outputs: Array<{ kind: string; id: string; name?: string; label?: string }>;
  successCriteria: string[];
  origin: string;
  installCount: number;
  publisherRef: string | null;
  priceCents: number | null;
  currency: string | null;
}

export interface InstalledOutput {
  outputId: string;
  kind: string;
  label: string;
  href: string | null;
  ref: string | null;
  detail: string;
  ok: boolean;
  error?: string;
}

/** The install refused because setup is not finished. Carries the step ids so
 *  the wizard can jump to the first one instead of saying "something is wrong". */
export class TemplateSetupIncompleteError extends Error {
  constructor(public readonly blockedBy: string[], public readonly details: Record<string, string>) {
    super('This template is not ready to install yet.');
    this.name = 'TemplateSetupIncompleteError';
  }
}

export const templatesApi = {
  list: (): Promise<{ templates: TemplateSummary[]; categories: string[] }> =>
    apiRequest('/api/templates'),

  get: (key: string): Promise<{ template: TemplateDetail; connectedConnectors: string[] }> =>
    apiRequest(`/api/templates/${encodeURIComponent(key)}`),

  /** Resolve the guided plan for the answers so far. POST because the answers
   *  ARE the input — nothing is written. */
  setup: (key: string, answers: GuidedAnswers, touched: string[]): Promise<GuidedPlan> =>
    apiRequest(`/api/templates/${encodeURIComponent(key)}/setup`, {
      method: 'POST',
      body: JSON.stringify({ answers, touched }),
    }),

  install: async (key: string, answers: GuidedAnswers): Promise<{ outputs: InstalledOutput[]; complete: boolean }> => {
    try {
      return await apiRequest(`/api/templates/${encodeURIComponent(key)}/install`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      });
    } catch (e) {
      // The server distinguishes "not ready" from "broken"; so does the wizard.
      const err = e as { code?: string; details?: { blockedBy?: string[]; errors?: Record<string, string> } };
      if (err?.code === 'setup_incomplete') {
        throw new TemplateSetupIncompleteError(err.details?.blockedBy ?? [], err.details?.errors ?? {});
      }
      throw e;
    }
  },

  publish: (key: string, publish: boolean): Promise<{ visibility: string }> =>
    apiRequest(`/api/templates/${encodeURIComponent(key)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ publish }),
    }),
};
