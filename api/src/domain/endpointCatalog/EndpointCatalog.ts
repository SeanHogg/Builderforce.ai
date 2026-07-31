export const EndpointEntryType = {
  REST_API: 'rest_api',
  GRAPHQL_QUERY: 'graphql_query',
  GRAPHQL_MUTATION: 'graphql_mutation',
  FRONTEND_ROUTE: 'frontend_route',
} as const;
export type EndpointEntryType = typeof EndpointEntryType[keyof typeof EndpointEntryType];

export const AuthRequirement = {
  PUBLIC: 'public',
  AUTH_REQUIRED: 'auth_required',
  ADMIN_ONLY: 'admin_only',
  OWNER_ONLY: 'owner_only',
  MANAGER_PLUS: 'manager_plus',
} as const;
export type AuthRequirement = typeof AuthRequirement[keyof typeof AuthRequirement];

export type EndpointCatalogId = number & { readonly __brand: 'EndpointCatalogId' };
export const asEndpointCatalogId = (n: number): EndpointCatalogId => n as EndpointCatalogId;

export interface EndpointCatalogProps {
  id: EndpointCatalogId;
  tenantId: number;
  type: EndpointEntryType;
  httpMethod: string | null;
  path: string;
  serviceName: string;
  componentName: string | null;
  description: string | null;
  authRequirement: AuthRequirement;
  owner: string | null;
  team: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  tags: string[] | null;
  deprecated: boolean;
  version: string | null;
  lastSeenAt: Date;
  firstSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class EndpointCatalogEntry {
  private constructor(private readonly props: EndpointCatalogProps) {}

  static create(props: EndpointCatalogProps): EndpointCatalogEntry {
    return new EndpointCatalogEntry(props);
  }

  static fromRow(row: Record<string, unknown>): EndpointCatalogEntry {
    return new EndpointCatalogEntry({
      id: row.id as EndpointCatalogId,
      tenantId: row.tenantId as number,
      type: row.type as EndpointEntryType,
      httpMethod: (row.httpMethod ?? null) as string | null,
      path: row.path as string,
      serviceName: row.serviceName as string,
      componentName: (row.componentName ?? null) as string | null,
      description: (row.description ?? null) as string | null,
      authRequirement: row.authRequirement as AuthRequirement,
      owner: (row.owner ?? null) as string | null,
      team: (row.team ?? null) as string | null,
      sourceFile: (row.sourceFile ?? null) as string | null,
      sourceLine: (row.sourceLine ?? null) as number | null,
      tags: (row.tags ?? null) as string[] | null,
      deprecated: Boolean(row.deprecated),
      version: (row.version ?? null) as string | null,
      lastSeenAt: row.lastSeenAt as Date,
      firstSeenAt: row.firstSeenAt as Date,
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
    });
  }

  get id(): EndpointCatalogId { return this.props.id; }
  get tenantId(): number { return this.props.tenantId; }
  get type(): EndpointEntryType { return this.props.type; }
  get httpMethod(): string | null { return this.props.httpMethod; }
  get path(): string { return this.props.path; }
  get serviceName(): string { return this.props.serviceName; }
  get componentName(): string | null { return this.props.componentName; }
  get description(): string | null { return this.props.description; }
  get authRequirement(): AuthRequirement { return this.props.authRequirement; }
  get owner(): string | null { return this.props.owner; }
  get team(): string | null { return this.props.team; }
  get sourceFile(): string | null { return this.props.sourceFile; }
  get sourceLine(): number | null { return this.props.sourceLine; }
  get tags(): string[] | null { return this.props.tags; }
  get deprecated(): boolean { return this.props.deprecated; }
  get version(): string | null { return this.props.version; }
  get lastSeenAt(): Date { return this.props.lastSeenAt; }
  get firstSeenAt(): Date { return this.props.firstSeenAt; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  toJSON(): EndpointCatalogProps {
    return { ...this.props };
  }

  toResponse(): Record<string, unknown> {
    return {
      id: this.props.id,
      tenantId: this.props.tenantId,
      type: this.props.type,
      httpMethod: this.props.httpMethod,
      path: this.props.path,
      serviceName: this.props.serviceName,
      componentName: this.props.componentName,
      description: this.props.description,
      authRequirement: this.props.authRequirement,
      owner: this.props.owner,
      team: this.props.team,
      sourceFile: this.props.sourceFile,
      sourceLine: this.props.sourceLine,
      tags: this.props.tags ?? [],
      deprecated: this.props.deprecated,
      version: this.props.version,
      lastSeenAt: this.props.lastSeenAt,
      firstSeenAt: this.props.firstSeenAt,
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
    };
  }
}

export interface SyncRunProps {
  id: number;
  tenantId: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt: Date | null;
  endpointsFound: number;
  endpointsAdded: number;
  endpointsUpdated: number;
  endpointsRemoved: number;
  errorMessage: string | null;
  createdAt: Date;
}
