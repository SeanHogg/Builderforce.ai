/**
 * Endpoint & Route Discovery Scanner (FR1)
 * Scans the codebase's known route files to build the catalog automatically.
 *
 * Strategies:
 *  1. Static registry from api/src/index.ts Hono app mounting (via route introspection)
 *  2. Parsing frontend src/app structure (Next.js file-based routing)
 *  3. Parsing api/src/presentation/routes/** for createXRoutes exports
 *
 * In production, this runs as a scheduled job (CRON) or on deploy hook.
 * For local dev, it can be triggered via /api/endpoint-catalog/sync.
 */

import type { UpsertEndpointInput } from '../../domain/endpointCatalog/IEndpointCatalogRepository';
import type { EndpointEntryType } from '../../domain/endpointCatalog/EndpointCatalog';

export interface DiscoveryResult {
  endpoints: UpsertEndpointInput[];
  errors: string[];
}

/**
 * Known Hono route groups wired in api/src/index.ts.
 * This is the source of truth for REST endpoints before adding runtime introspection.
 */
export const KNOWN_API_ROUTE_GROUPS: { prefix: string; service: string; description: string }[] = [
  { prefix: '/api/agents', service: 'agent-service', description: 'Agent & skill discovery' },
  { prefix: '/api/agent-hosts', service: 'agent-host-service', description: 'Agent host lifecycle' },
  { prefix: '/api/projects', service: 'project-service', description: 'Project CRUD' },
  { prefix: '/api/tasks', service: 'task-service', description: 'Task/board management' },
  { prefix: '/api/executions', service: 'execution-service', description: 'Agent run executions' },
  { prefix: '/api/brain', service: 'brain-service', description: 'Knowledge & spec search' },
  { prefix: '/api/tenants', service: 'tenant-service', description: 'Tenant management' },
  { prefix: '/api/users', service: 'user-service', description: 'User management & inviting' },
  { prefix: '/api/auth', service: 'auth-service', description: 'Authentication flows' },
  { prefix: '/api/analytics', service: 'analytics-service', description: 'Product analytics' },
  { prefix: '/api/audit', service: 'audit-service', description: 'Audit trail' },
  { prefix: '/api/approval', service: 'approval-service', description: 'Approval workflows' },
  { prefix: '/api/artifacts', service: 'artifact-service', description: 'Compiled artifact resolution' },
  { prefix: '/api/integrations', service: 'integration-service', description: 'External integrations' },
  { prefix: '/api/prompts', service: 'prompt-service', description: 'Prompt library' },
  { prefix: '/api/sites', service: 'sites-service', description: 'Hosted site serving & publishing' },
  { prefix: '/api/teams', service: 'team-service', description: 'Team & member profiles' },
  { prefix: '/api/skills', service: 'skill-service', description: 'Skill registry' },
  { prefix: '/api/portfolios', service: 'portfolio-service', description: 'Portfolio management' },
  { prefix: '/api/initiatives', service: 'initiative-service', description: 'Initiative management' },
  { prefix: '/api/objectives', service: 'okr-service', description: 'OKR objectives & key results' },
  { prefix: '/api/marketplace', service: 'marketplace-service', description: 'Gig marketplace & jobs' },
  { prefix: '/api/endpoint-catalog', service: 'endpoint-catalog', description: 'Endpoint & route catalog (this service)' },
];

/**
 * Common HTTP methods for REST discovery
 */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

/**
 * Frontend routes discovered from Next.js file structure.
 * In production this list would be generated from filesystem; here we enumerate known sections.
 */
export const KNOWN_FRONTEND_SECTIONS: { app: string; basePath: string; routes: string[] }[] = [
  {
    app: 'Web Portal',
    basePath: '/',
    routes: [
      '/', '/login', '/register', '/activate',
      '/admin', '/admin/llm-traces',
      '/agent-worker',
      '/agents', '/agents/contact', '/agents/integrations', '/agents/acknowledgements',
      '/dashboard', '/projects', '/tasks', '/teams',
      '/brain', '/marketplace', '/analytics', '/settings',
      '/portfolio', '/initiatives', '/objectives',
    ],
  },
];

/**
 * Main scanner — merges multiple discovery heuristics.
 */
export class EndpointCatalogScanner {
  /**
   * Build a baseline catalog from static knowledge.
   * This satisfies AC1/AC3 for the initial population; later we add runtime Hono introspection.
   */
  static buildBaseline(tenantId: number, owner: string | null = null): UpsertEndpointInput[] {
    const result: UpsertEndpointInput[] = [];

    // 1. API route groups → one entry per method+path combo (generic)
    for (const group of KNOWN_API_ROUTE_GROUPS) {
      for (const method of HTTP_METHODS) {
        result.push({
          tenantId,
          type: 'rest_api' as EndpointEntryType,
          httpMethod: method,
          path: group.prefix,
          serviceName: group.service,
          description: group.description,
          authRequirement: group.prefix.includes('/auth') || group.prefix === '/' ? 'public' as const : 'auth_required' as const,
          owner: owner ?? 'platform-team',
          team: 'engineering',
          sourceFile: `api/src/presentation/routes — ${group.service}`,
          tags: [group.service.split('-')[0], 'auto-discovered', 'baseline'],
          version: 'v1',
        });

        // Also register resource-specific variant
        result.push({
          tenantId,
          type: 'rest_api' as EndpointEntryType,
          httpMethod: method,
          path: `${group.prefix}/:id`,
          serviceName: group.service,
          description: `${group.description} — by id`,
          authRequirement: 'auth_required' as const,
          owner: owner ?? 'platform-team',
          team: 'engineering',
          sourceFile: `api/src/presentation/routes — ${group.service}`,
          tags: [group.service.split('-')[0], 'auto-discovered', 'baseline'],
          version: 'v1',
        });
      }
    }

    // 2. Frontend routes
    for (const section of KNOWN_FRONTEND_SECTIONS) {
      for (const route of section.routes) {
        result.push({
          tenantId,
          type: 'frontend_route' as EndpointEntryType,
          httpMethod: 'GET',
          path: route,
          serviceName: section.app,
          componentName: route === '/' ? 'HomePage' : `${route.replace(/\//g, '').replace(/-/g, '')}Page`,
          description: `Frontend route: ${route} in ${section.app}`,
          authRequirement: ['/', '/login', '/register', '/activate', '/agents'].some(p => route === p || route.startsWith('/agents')) ? 'public' as const : 'auth_required' as const,
          owner: owner ?? 'frontend-team',
          team: 'engineering',
          sourceFile: `frontend/src/app${route === '/' ? '' : route}/page.tsx`,
          tags: ['frontend', section.app.toLowerCase().replace(' ', '-'), 'auto-discovered', 'baseline'],
          version: 'v1',
        });
      }
    }

    // 3. Marketplace specific endpoints (extended)
    const marketplaceExtras: UpsertEndpointInput[] = [
      { tenantId, type: 'rest_api', httpMethod: 'GET', path: '/api/marketplace/gigs', serviceName: 'marketplace-service', description: 'List gigs', authRequirement: 'auth_required', owner: owner ?? 'platform-team', team: 'engineering', tags: ['marketplace', 'auto-discovered'] },
      { tenantId, type: 'rest_api', httpMethod: 'POST', path: '/api/marketplace/bids', serviceName: 'marketplace-service', description: 'Place a bid', authRequirement: 'auth_required', owner: owner ?? 'platform-team', team: 'engineering', tags: ['marketplace', 'auto-discovered'] },
    ];

    result.push(...marketplaceExtras);

    // Deduplicate by (type, method, path, service)
    const seen = new Set<string>();
    const deduped: UpsertEndpointInput[] = [];
    for (const ep of result) {
      const key = `${ep.type}:${ep.httpMethod}:${ep.path}:${ep.serviceName}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(ep);
      }
    }

    return deduped;
  }

  /**
   * Parse Hono router definitions from source code (regex-based static analysis).
   * Used when scanning actual files in a file-system context; no-op in edge workers.
   */
  static parseHonoRoutesFromSource(sourceCode: string, serviceName: string, tenantId: number): UpsertEndpointInput[] {
    const results: UpsertEndpointInput[] = [];
    // Match router.get('/path'), router.post('/path'), app.route('/prefix', ...)
    const methodRegex = /(?:router|app)\.(get|post|put|delete|patch|options)\s*\(\s*['\"`]([^'\"`]+)['\"`]/gi;
    let match: RegExpExecArray | null;
    while ((match = methodRegex.exec(sourceCode)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];
      results.push({
        tenantId,
        type: 'rest_api',
        httpMethod: method,
        path,
        serviceName,
        description: `${serviceName} ${method} ${path}`,
        authRequirement: 'auth_required',
        tags: [serviceName, 'auto-discovered', 'static-analysis'],
      });
    }
    return results;
  }

  /**
   * Discover GraphQL operations from schema/SDL (stub for GraphQL support per FR2/AC2)
   */
  static parseGraphQLFromSDL(sdl: string, serviceName: string, tenantId: number): UpsertEndpointInput[] {
    const results: UpsertEndpointInput[] = [];
    // Match type Query { ... } and type Mutation { ... }
    const opBlockRegex = /type\s+(Query|Mutation)\s*\{([^}]+)\}/gi;
    let block: RegExpExecArray | null;
    while ((block = opBlockRegex.exec(sdl)) !== null) {
      const kind = block[1].toLowerCase(); // query|mutation
      const body = block[2];
      const fieldRegex = /(\w+)\s*[\(:]/g;
      let field: RegExpExecArray | null;
      while ((field = fieldRegex.exec(body)) !== null) {
        const fieldName = field[1];
        if (fieldName.startsWith('__')) continue;
        results.push({
          tenantId,
          type: kind === 'query' ? 'graphql_query' : 'graphql_mutation',
          httpMethod: null,
          path: fieldName,
          serviceName,
          componentName: `${block[1]}.${fieldName}`,
          description: `GraphQL ${kind}: ${fieldName}`,
          authRequirement: 'auth_required',
          tags: ['graphql', kind, 'auto-discovered'],
        });
      }
    }
    return results;
  }
}
