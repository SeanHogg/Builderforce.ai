import { eq, inArray } from 'drizzle-orm';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Project, ProjectProps } from '../../domain/project/Project';
import { ProjectId, ProjectStatus, TenantId, asProjectId, asTenantId } from '../../domain/shared/types';
import { projects as projectsTable } from '../database/schema';
import type { Db } from '../database/connection';

/**
 * Concrete Postgres implementation of IProjectRepository.
 *
 * Maps between the Drizzle row type and the Project domain entity.
 * No business logic lives here – only translation + persistence.
 */
export class ProjectRepository implements IProjectRepository {
  constructor(private readonly db: Db) {}

  async findByTenant(tenantId: TenantId): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.tenantId, tenantId));
    return rows.map(toDomain);
  }

  async findById(id: ProjectId): Promise<Project | null> {
    const [row] = await this.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, id))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async findByPublicId(publicId: string): Promise<Project | null> {
    const [row] = await this.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.publicId, publicId))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async findByKey(key: string): Promise<Project | null> {
    const [row] = await this.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.key, key.toUpperCase()))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async save(project: Project): Promise<Project> {
    const plain = project.toPlain();
    const [inserted] = await this.db
      .insert(projectsTable)
      .values({
        tenantId:        plain.tenantId,
        key:             plain.key,
        name:            plain.name,
        description:     plain.description ?? undefined,
        template:        plain.template ?? undefined,
        rootWorkingDirectory: plain.rootWorkingDirectory ?? undefined,
        status:          plain.status,
        sourceControlIntegrationId: plain.sourceControlIntegrationId ?? undefined,
        sourceControlProvider: plain.sourceControlProvider ?? undefined,
        sourceControlRepoFullName: plain.sourceControlRepoFullName ?? undefined,
        sourceControlRepoUrl: plain.sourceControlRepoUrl ?? undefined,
        githubRepoUrl:   plain.githubRepoUrl ?? undefined,
        githubRepoOwner: plain.githubRepoOwner ?? undefined,
        githubRepoName:  plain.githubRepoName ?? undefined,
        governance:     plain.governance ?? undefined,
      })
      .returning();
    if (!inserted) throw new Error('Insert returned no rows');
    return toDomain(inserted);
  }

  async update(project: Project): Promise<Project> {
    const plain = project.toPlain();
    const [updated] = await this.db
      .update(projectsTable)
      .set({
        name:            plain.name,
        description:     plain.description ?? undefined,
        template:        plain.template ?? undefined,
        rootWorkingDirectory: plain.rootWorkingDirectory ?? undefined,
        status:          plain.status,
        sourceControlIntegrationId: plain.sourceControlIntegrationId ?? undefined,
        sourceControlProvider: plain.sourceControlProvider ?? undefined,
        sourceControlRepoFullName: plain.sourceControlRepoFullName ?? undefined,
        sourceControlRepoUrl: plain.sourceControlRepoUrl ?? undefined,
        githubRepoUrl:   plain.githubRepoUrl ?? undefined,
        githubRepoOwner: plain.githubRepoOwner ?? undefined,
        githubRepoName:  plain.githubRepoName ?? undefined,
        governance:     plain.governance ?? undefined,
        updatedAt:       plain.updatedAt,
      })
      .where(eq(projectsTable.id, plain.id))
      .returning();
    if (!updated) throw new Error('Update returned no rows');
    return toDomain(updated);
  }

  async delete(id: ProjectId): Promise<void> {
    await this.db.delete(projectsTable).where(eq(projectsTable.id, id));
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

type Row = typeof projectsTable.$inferSelect;

function toDomain(row: Row): Project {
  return Project.reconstitute({
    id:              asProjectId(row.id),
    publicId:        row.publicId,
    tenantId:        asTenantId(row.tenantId),
    key:             row.key,
    name:            row.name,
    description:     row.description ?? null,
    template:        row.template ?? null,
    rootWorkingDirectory: row.rootWorkingDirectory ?? null,
    status:          row.status as ProjectStatus,
    sourceControlIntegrationId: row.sourceControlIntegrationId ?? null,
    sourceControlProvider: row.sourceControlProvider ?? null,
    sourceControlRepoFullName: row.sourceControlRepoFullName ?? null,
    sourceControlRepoUrl: row.sourceControlRepoUrl ?? null,
    githubRepoUrl:   row.githubRepoUrl ?? null,
    githubRepoOwner: row.githubRepoOwner ?? null,
    githubRepoName:  row.githubRepoName ?? null,
    governance:      row.governance ?? null,
    createdAt:       row.createdAt,
    updatedAt:       row.updatedAt,
  });
}
