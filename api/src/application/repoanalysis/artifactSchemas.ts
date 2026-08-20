/**
 * The strict JSON Schema the gateway enforces for each Architect artifact.
 *
 * Generation used to ask for `response_format: { type: 'json_object' }` and spell
 * the shape out in prose, which buys nothing but "it is SOME object": a model was
 * free to return `{"views": …}` instead of `{"logical": …}`, and the renderer's
 * defensive readers turned that into an artifact of empty sections that still
 * counted as `complete`. A schema makes the shape a decoding constraint instead
 * of a request, so the failure mode moves from "silently empty report" to a real
 * ArtifactGenerationError the retry path can act on.
 *
 * Each schema mirrors exactly one of the parsed-shape interfaces in
 * ArchitectAnalysisService. Strict mode requires every property to be listed in
 * `required` and `additionalProperties: false` on every object — so these are
 * "all fields always present", and the readers stay defensive anyway because the
 * gateway may DOWNGRADE a schema a vendor rejects (see
 * `LlmProxyService.downgradeResponseFormat`, which re-sends the same request in
 * json_object mode with the schema appended as a system instruction).
 */
import type { ArtifactKind } from './types';

/** OpenAI-compatible strict response_format envelope. */
export interface StrictJsonSchemaFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
}

const string = { type: 'string' } as const;
const stringArray = { type: 'array', items: { type: 'string' } } as const;

/** An object whose every declared property is required — what strict mode demands. */
function closed(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/** One 4+1 view: prose plus a Mermaid diagram source (unfenced). */
const ARCH_VIEW = closed({
  markdown: string,
  mermaid: string,
});

/** A 0–10 principle score with grounded notes. */
const PRINCIPLE_SCORE = closed({
  score: { type: 'number', minimum: 0, maximum: 10 },
  notes: string,
});

/** The patterns principle also names the concrete patterns it recognised. */
const PATTERNS_SCORE = closed({
  score: { type: 'number', minimum: 0, maximum: 10 },
  notes: string,
  detected: stringArray,
});

/** Schema per artifact kind — mirrors the `*Data` interfaces one for one. */
const SCHEMAS: Record<ArtifactKind, { name: string; schema: Record<string, unknown> }> = {
  diagnostic: {
    name: 'repo_diagnostic',
    schema: closed({
      summary: string,
      purpose: string,
      primaryLanguages: stringArray,
      frameworks: stringArray,
      keyComponents: {
        type: 'array',
        items: closed({ name: string, responsibility: string }),
      },
      // Written straight back onto `projects.description`, so the cap is stated
      // to the model rather than only enforced by the truncating reader.
      suggestedProjectDescription: { type: 'string', maxLength: 280 },
      suggestedModality: { type: 'string', enum: ['designer', 'architect', 'developer'] },
    }),
  },
  recommendation: {
    name: 'modernization_recommendation',
    schema: closed({
      recommendation: { type: 'string', enum: ['brownfield', 'greenfield', 'parallel'] },
      rationale: string,
      risks: stringArray,
      firstSteps: stringArray,
      brownfieldScore: { type: 'number', minimum: 0, maximum: 100 },
      greenfieldScore: { type: 'number', minimum: 0, maximum: 100 },
    }),
  },
  business: {
    name: 'business_summary',
    schema: closed({
      summary: string,
      audience: string,
      valueProps: stringArray,
      capabilities: stringArray,
    }),
  },
  arch_4plus1: {
    name: 'four_plus_one_views',
    schema: closed({
      logical: ARCH_VIEW,
      process: ARCH_VIEW,
      development: ARCH_VIEW,
      physical: ARCH_VIEW,
      scenarios: ARCH_VIEW,
    }),
  },
  antipatterns: {
    name: 'antipatterns_report',
    schema: closed({
      findings: {
        type: 'array',
        items: closed({
          name: string,
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          evidence: string,
          recommendation: string,
        }),
      },
    }),
  },
  principles: {
    name: 'design_principles_assessment',
    schema: closed({
      dry: PRINCIPLE_SCORE,
      solid: PRINCIPLE_SCORE,
      ddd: PRINCIPLE_SCORE,
      patterns: PATTERNS_SCORE,
    }),
  },
};

/** The strict `response_format` for one artifact kind. PURE. */
export function artifactResponseFormat(kind: ArtifactKind): StrictJsonSchemaFormat {
  const { name, schema } = SCHEMAS[kind];
  return { type: 'json_schema', json_schema: { name, strict: true, schema } };
}
