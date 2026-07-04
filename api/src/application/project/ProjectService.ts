import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { Project } from '../../domain/project/Project';
import { ProjectId, ProjectStatus, TenantId, asProjectId, asTenantId } from '../../domain/shared/types';
import { NotFoundError, ConflictError, ForbiddenError } from '../../domain/shared/errors';
import { buildProjectKey } from './projectKey';

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
  governance?:    string | null;
  modality?:      string | null;
  origin?:        string | null;
}

export interface UpdateProjectDto {
  key?: string;
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
  governance?: string | null;
  modality?: string | null;
  /** Explicit project deadline (0255). null clears it (falls back to the derived task deadline). */
  dueDate?: Date | null;
}

/**
 * Application service: orchestrates Project use cases.
 *
 * Depends only on the repository *interface* (Dependency Inversion Principle).
 * Contains no infrastructure concerns (SQL, HTTP, etc.).
 */
export class ProjectService {
  /**
   * `tasks` is optional: it's only needed on the key-change path (re-keying every
   * task to a renamed Project Key). Call sites that never change a project key
   * (MCP project.update, delta ingestion) may omit it.
   */
  constructor(
    private readonly projects: IProjectRepository,
    private readonly tasks?: ITaskRepository,
  ) {}

  async listProjects(tenantId: number): Promise<Project[]> {
    return this.projects.findByTenant(asTenantId(tenantId));
  }

  async findByKey(key: string): Promise<Project | null> {
    return this.projects.findByKey(key);
  }

  /**
   * Derive a project key from `name` (via `buildProjectKey`) that is free of
   * collisions, suffixing `-2`, `-3`, … when the base key is already taken.
   * Use this for the AUTO-generated key path; an explicitly user-supplied key
   * keeps the hard `ConflictError` in `createProject` so the user learns their
   * chosen key is taken. The project key is globally unique, so an unsuffixed
   * collapse (e.g. every "Untitled" project → `<tid>-PROJECT`) would otherwise
   * make the second such project fail to create.
   */
  async buildUniqueKey(tenantId: number, name: string): Promise<string> {
    const base = buildProjectKey(tenantId, name);
    if (!(await this.projects.findByKey(base))) return base;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}-${n}`.slice(0, 50);
      if (!(await this.projects.findByKey(candidate))) return candidate;
    }
    // Pathological fallback — keep it deterministic and bounded.
    return `${base}-${tenantId}`.slice(0, 50);
  }

  async getProject(id: number | string, callerTenantId: number): Promise<Project> {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const project = typeof id === 'string' && UUID_RE.test(id)
      ? await this.projects.findByPublicId(id)
      : await this.projects.findById(asProjectId(Number(id)));
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
      governance: dto.governance ?? null,
      modality: dto.modality ?? 'designer',
      origin: dto.origin ?? null,
    });

    return this.projects.save(project);
  }

  async updateProject(id: number, dto: UpdateProjectDto, callerTenantId: number): Promise<Project> {
    const project = await this.getProject(id, callerTenantId);

    // if key is changing, make sure new key isn't already taken
    if (dto.key !== undefined) {
      const trimmed = dto.key.trim().toUpperCase();
      if (trimmed && trimmed !== project.key) {
        const existing = await this.projects.findByKey(trimmed as any);
        if (existing && existing.id !== project.id) {
          throw new ConflictError(`Project key '${trimmed}' is already taken`);
        }
      }
    }

    const { githubRepoOwner, githubRepoName } = dto.githubRepoUrl !== undefined
      ? parseGithubUrl(dto.githubRepoUrl)
      : { githubRepoOwner: project.githubRepoOwner, githubRepoName: project.githubRepoName };

    const updated = project.update({
      key: dto.key,
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
      governance: dto.governance,
      modality: dto.modality,
      dueDate: dto.dueDate,
    });

    // Detect a Project Key change from the DTO: the domain `update` treats an
    // omitted key as "leave unchanged", so the intended new key can't be read
    // back off the saved aggregate. Normalize exactly as the domain does.
    const newKey = dto.key?.trim() ? dto.key.trim().toUpperCase() : null;
    const keyChanged = newKey !== null && newKey !== project.key;

    const saved = await this.projects.update(updated);

    // When the Project Key changes, carry every existing task onto the new
    // prefix (`<oldKey>-071` → `<newKey>-071`) so the whole project — existing
    // and future tasks alike — shares one key. New tasks already mint off
    // `project.key`, so this closes the gap for the ones created before the rename.
    if (keyChanged && this.tasks) {
      await this.tasks.rekeyProject(saved.id, newKey);
    }

    return saved;
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
