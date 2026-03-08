import { ProjectId, ProjectStatus, TenantId } from '../shared/types';
import { ValidationError } from '../shared/errors';

export type SourceControlProvider = 'github' | 'bitbucket';

export interface ProjectProps {
  id:              ProjectId;
  tenantId:        TenantId;
  key:             string;
  name:            string;
  description:     string | null;
  /** IDE: template used to seed initial files (e.g. "vanilla"). */
  template:        string | null;
  rootWorkingDirectory: string | null;
  status:          ProjectStatus;
  sourceControlIntegrationId: number | null;
  sourceControlProvider: SourceControlProvider | null;
  sourceControlRepoFullName: string | null;
  sourceControlRepoUrl: string | null;
  githubRepoUrl:   string | null;
  githubRepoOwner: string | null;
  githubRepoName:  string | null;
  governance:      string | null;
  createdAt:       Date;
  updatedAt:       Date;
}

/**
 * Project aggregate root.
 *
 * All mutations return a *new* Project instance (value-object style
 * immutability) so the application layer can track change history without
 * side-effects leaking across call sites.
 */
export class Project {
  private constructor(private readonly props: ProjectProps) {}

  // ------------------------------------------------------------------
  // Factory methods
  // ------------------------------------------------------------------

  /**
   * Create a brand-new Project (id will be assigned by the DB on persist).
   * Enforces domain invariants before the object can exist.
   */
  static create(
    props: Omit<ProjectProps, 'id' | 'createdAt' | 'updatedAt'>,
  ): Project {
    if (!props.key.trim()) throw new ValidationError('Project key is required');
    if (!props.name.trim()) throw new ValidationError('Project name is required');

    const now = new Date();
    return new Project({
      ...props,
      template: props.template ?? null,
      id: 0 as ProjectId,
      key: props.key.trim().toUpperCase(),
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Reconstitute an existing Project from storage. No validation – trust DB. */
  static reconstitute(props: ProjectProps): Project {
    return new Project(props);
  }

  // ------------------------------------------------------------------
  // Accessors
  // ------------------------------------------------------------------

  get id():              ProjectId  { return this.props.id; }
  get tenantId():        TenantId   { return this.props.tenantId; }
  get key():             string     { return this.props.key; }
  get name(): string { return this.props.name; }
  get description(): string | null { return this.props.description; }
  get template(): string | null { return this.props.template ?? null; }
  get rootWorkingDirectory(): string | null { return this.props.rootWorkingDirectory; }
  get status(): ProjectStatus { return this.props.status; }
  get sourceControlIntegrationId(): number | null { return this.props.sourceControlIntegrationId; }
  get sourceControlProvider(): SourceControlProvider | null { return this.props.sourceControlProvider; }
  get sourceControlRepoFullName(): string | null { return this.props.sourceControlRepoFullName; }
  get sourceControlRepoUrl(): string | null { return this.props.sourceControlRepoUrl; }
  get githubRepoUrl(): string | null { return this.props.githubRepoUrl; }
  get githubRepoOwner(): string | null { return this.props.githubRepoOwner; }
  get githubRepoName(): string | null { return this.props.githubRepoName; }
  get governance(): string | null { return this.props.governance; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  // ------------------------------------------------------------------
  // Behaviour
  // ------------------------------------------------------------------

  update(
    updates: Partial<
      Pick<
        ProjectProps,
        'name' | 'description' | 'template' | 'rootWorkingDirectory' | 'status' | 'sourceControlIntegrationId' | 'sourceControlProvider' | 'sourceControlRepoFullName' | 'sourceControlRepoUrl' | 'githubRepoUrl' | 'githubRepoOwner' | 'githubRepoName' | 'governance'
      >
    >,
  ): Project {
    return new Project({ ...this.props, ...updates, updatedAt: new Date() });
  }

  archive(): Project {
    return this.update({ status: ProjectStatus.ARCHIVED });
  }

  /** Snapshot for persistence / serialisation. */
  toPlain(): ProjectProps {
    return { ...this.props };
  }
}
