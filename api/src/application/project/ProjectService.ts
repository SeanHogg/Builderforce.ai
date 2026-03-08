import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Project } from '../../domain/project/Project';
import { ProjectId, ProjectStatus, TenantId, asProjectId, asTenantId } from '../../domain/shared/types';
import { NotFoundError, ConflictError, ForbiddenError } from '../../domain/shared/errors';

type SourceControlProvider = 'github' | 'bitbucket';

export interface CreateProjectDto {
  tenantId:       number;
  key:            string;
  name:           string;
  description?:   string | null;
  /** IDE: template to seed initial files (e.g. "vanilla"). */
  template?:      string | null;
  rootWorkingDirectory?: string | null;
  sourceControlIntegrationId?: number | null;
  sourceControlProvider?: SourceControlProvider | null;
  sourceControlRepoFullName?: string | null;
  sourceControlRepoUrl?: string | null;
  githubRepoUrl?: string | null;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string | null;
  template?: string | null;
  rootWorkingDirectory?: string | null;
  status?: ProjectStatus;
  sourceControlIntegrationId?: number | null;
  sourceControlProvider?: SourceControlProvider | null;
  sourceControlRepoFullName?: string | null;
  sourceControlRepoUrl?: string | null;
  githubRepoUrl?: string | null;
}

/**
 * Application service: orchestrates Project use cases.
 *
 * Depends only on the repository *interface* (Dependency Inversion Principle).
 * Contains no infrastructure concerns (SQL, HTTP, etc.).
 */
export class ProjectService {
  constructor(private readonly projects: IProjectRepository) {}

  async listProjects(tenantId: number): Promise<Project[]> {
    return this.projects.findByTenant(asTenantId(tenantId));
  }

  async getProject(id: number, callerTenantId: number): Promise<Project> {
    const project = await this.projects.findById(asProjectId(id));
    if (!project) throw new NotFoundError('Project', id);
    if (project.tenantId !== callerTenantId) throw new ForbiddenError('Project belongs to a different workspace');
    return project;
  }

  async createProject(dto: CreateProjectDto): Promise<Project> {
    const existing = await this.projects.findByKey(dto.key.trim().toUpperCase());
    if (existing) {
      throw new ConflictError(`Project key '${dto.key.toUpperCase()}' is already taken`);
    }

    const { githubRepoOwner, githubRepoName } = parseGithubUrl(dto.githubRepoUrl ?? null);

    const project = Project.create({
      tenantId: asTenantId(dto.tenantId),
      key: dto.key,
      name: dto.name,
      description: dto.description ?? null,
      template: dto.template ?? null,
      rootWorkingDirectory: dto.rootWorkingDirectory ?? null,
      status: ProjectStatus.ACTIVE,
      sourceControlIntegrationId: dto.sourceControlIntegrationId ?? null,
      sourceControlProvider: dto.sourceControlProvider ?? null,
      sourceControlRepoFullName: dto.sourceControlRepoFullName ?? null,
      sourceControlRepoUrl: dto.sourceControlRepoUrl ?? null,
      githubRepoUrl: dto.githubRepoUrl ?? null,
      githubRepoOwner,
      githubRepoName,
    });

    return this.projects.save(project);
  }

  async updateProject(id: number, dto: UpdateProjectDto, callerTenantId: number): Promise<Project> {
    const project = await this.getProject(id, callerTenantId);

    const { githubRepoOwner, githubRepoName } = dto.githubRepoUrl !== undefined
      ? parseGithubUrl(dto.githubRepoUrl)
      : { githubRepoOwner: project.githubRepoOwner, githubRepoName: project.githubRepoName };

    const updated = project.update({
      name: dto.name,
      description: dto.description,
      template: dto.template,
      rootWorkingDirectory: dto.rootWorkingDirectory,
      status: dto.status,
      sourceControlIntegrationId: dto.sourceControlIntegrationId,
      sourceControlProvider: dto.sourceControlProvider,
      sourceControlRepoFullName: dto.sourceControlRepoFullName,
      sourceControlRepoUrl: dto.sourceControlRepoUrl,
      githubRepoUrl: dto.githubRepoUrl,
      githubRepoOwner,
      githubRepoName,
    });

    return this.projects.update(updated);
  }

  async deleteProject(id: number, callerTenantId: number): Promise<void> {
    await this.getProject(id, callerTenantId); // throws NotFoundError or ForbiddenError
    await this.projects.delete(asProjectId(id));
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function parseGithubUrl(
  url: string | null,
): { githubRepoOwner: string | null; githubRepoName: string | null } {
  if (!url) return { githubRepoOwner: null, githubRepoName: null };
  try {
    const parts = new URL(url).pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { githubRepoOwner: parts[0], githubRepoName: parts[1] };
    }
  } catch {
    // fall through
  }
  return { githubRepoOwner: null, githubRepoName: null };
}
