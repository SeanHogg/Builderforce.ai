import { and, eq, inArray } from 'drizzle-orm';
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
    // Exclude rows that exist purely as an ide_project's storage backing (0224) —
    // those are managed from the IDE dashboard, not the board/PMO project list.
    const rows = await this.db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.tenantId, tenantId), eq(projectsTable.isIdeStorage, false)));
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
        modality:        plain.modality ?? undefined,
        origin:          plain.origin ?? undefined,
        initiativeId:    plain.initiativeId ?? undefined,
        dueDate:         plain.dueDate ?? undefined,
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
        modality:        plain.modality ?? undefined,
        // Written directly (not `?? undefined`): null must persist so a project
        // can be UNassigned from its initiative. Drizzle still skips `undefined`,
        // so omitting initiativeId from the update DTO leaves the link unchanged.
        initiativeId:    plain.initiativeId,
        // Written directly too: null must persist so a PM can CLEAR the explicit
        // deadline (falling back to the derived task-based one).
        dueDate:         plain.dueDate,
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
    modality:        row.modality ?? 'designer',
    origin:          row.origin ?? null,
    initiativeId:    row.initiativeId ?? null,
    dueDate:         row.dueDate ?? null,
    createdAt:       row.createdAt,
    updatedAt:       row.updatedAt,
  });
}
