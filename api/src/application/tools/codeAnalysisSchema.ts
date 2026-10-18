import { z } from 'zod';
const location = z.object({ path: z.string().min(1).max(2000), startLine: z.number().int().positive(), endLine: z.number().int().positive() });
export const CodeAnalysisSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), capturedAt: z.string().datetime(),
  source: z.object({ commit: z.string().max(64).nullable(), branch: z.string().max(255).nullable(), dirty: z.boolean().nullable(), scope: z.string().max(1000).optional(), repository: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/).optional() }),
  tools: z.array(z.object({ name: z.enum(['dependency-cruiser', 'jscpd', 'knip']), version: z.string().max(40), status: z.enum(['complete', 'failed']), error: z.string().max(2000).optional() })).length(3)
    .refine((tools) => new Set(tools.map((tool) => tool.name)).size === 3, 'Each analyzer must report coverage'),
  nodes: z.array(z.string().min(1).max(2000)).max(10000),
  edges: z.array(z.object({ from: z.string().max(2000), to: z.string().max(2000), circular: z.boolean() })).max(50000),
  issues: z.array(z.object({ id: z.string().max(20000), kind: z.enum(['duplicate', 'unused-file', 'unused-export', 'unused-dependency']),
    locations: z.array(location).min(1).max(20), symbol: z.string().max(2000).optional(), snippet: z.string().max(4000).optional() })).max(10000),
});
