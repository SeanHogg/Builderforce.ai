import { eq } from 'drizzle-orm';
import { ProjectId, TenantId, asProjectId } from '../../domain/shared/types';
import { IHealthProfileRepository } from '../../domain/health/IHealthProfileRepository';
import { HealthProfile } from '../../domain/health/HealthProfile';
import { HealthProfilePlain } from '../../domain/health/HealthProfile';
import { healthProfiles, healthProfileVersions } from '../database/schema';
import type { Db } from '../database/connection';

/**
* Concrete Postgres implementation of IHealthProfileRepository using Drizzle ORM.
*/
export class HealthProfileRepository implements IHealthProfileRepository {
  constructor(private readonly db: Db) {}

  /**
  * Find active HealthProfile for a project (by project_id).
  * @returns null if no active profile exists.
  */
  async findByProjectId(projectId: ProjectId): Promise<HealthProfile | null> {
    const rows = await this.db
      .select()
      .from(healthProfiles)
      .where(eq(healthProfiles.projectId, projectId))
      .limit(1);
    return rows.length > 0 ? this.rowToProfile(rows[0]) : null;
  }

  /**
  * Find a historical version by its versionId (from health_profile_versions.id).
  * Uses join to the active table to fetch all fields including projectId/tenantId.
  */
  async findVersionById(versionId: string): Promise<HealthProfile | null> {
    const rows = await this.db
      .select()
      .from(healthProfiles)
      .where(eq(healthProfiles.id, versionId))
      .limit(1);
    return rows.length > 0 ? this.rowToProfile(rows[0]) : null;
  }

  /**
  * Save a new HealthProfile (create or replace) and produce an immutable version snapshot.
  * Enforces per-project uniqueness (Project-level foreign key).
  * - On first save (no existing active), inserts into health_profiles and a version record into health_profile_versions.
  * - On re-save / update (exists), updates existing active (still unique) and appends a version record into health_profile_versions.
  */
  async saveWithVersion(profile: HealthProfile): Promise<{ profile: HealthProfile; versionId: string }> {
    const plain = profile.toPlain(); // includes schemaVersion, demogs, medHistory, symptoms, medList, lifestyle, customFields, createdAt, updatedAt
    const now = new Date();
    const versionId = crypto.randomUUID();

    // Upsert the active profile. Existing rows must have the same project_id (uniqueness enforced at DB).
    // id and schemaVersion are updated as needed; versionId is a new row in health_profile_versions for the snapshot.
    // This mirrors the project_facts upsert semantics of updating the active record.
    const [upserted] = await this.db
      .insert(healthProfiles)
      .values({
        id: plain.profileId,
        projectId: plain.projectId,
        schemaVersion: plain.schemaVersion,
        demographics: plain.demographics,
        medicalHistory: plain.medicalHistory,
        currentSymptoms: plain.currentSymptoms,
        medications: plain.medications,
        lifestyle: plain.lifestyle,
        customFields: plain.customFields,
        createdAt: now, // re-normalized from original if updating
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: healthProfiles.projectId,
        set: {
          id: plain.profileId,
          schemaVersion: plain.schemaVersion,
          demographics: plain.demographics,
          medicalHistory: plain.medicalHistory,
          currentSymptoms: plain.currentSymptoms,
          medications: plain.medications,
          lifestyle: plain.lifestyle,
          customFields: plain.customFields,
          updatedAt: now,
        },
      })
      .returning();

    if (!upserted) throw new Error('Upsert returned no rows; versionId: ' + versionId);

    // Insert a version snapshot into health_profile_versions. This persists every save/update.
    await this.db
      .insert(healthProfileVersions)
      .values({
        id: versionId,
        profileId: plain.profileId,
        projectId: plain.projectId,
        tenantId: null, // not a project-level FK, no tenant_id in health_profile_versions
        createdAt: now,
      });

    // Return the upserted profile (as persisted).
    const persisted = this.rowToProfile({
      id: upserted.id,
      projectId: upserted.projectId,
      schemaVersion: upserted.schemaVersion,
      demographics: upserted.demographics,
      medicalHistory: upserted.medicalHistory,
      currentSymptoms: upserted.currentSymptoms,
      medications: upserted.medications,
      lifestyle: upserted.lifestyle,
      customFields: upserted.customFields,
      createdAt: upserted.createdAt,
      updatedAt: upserted.updatedAt,
    });

    return { profile: persisted, versionId };
  }

  /**
  * Delete the active HealthProfile (and its fork versions) for a project.
  */
  async deleteByProjectId(projectId: ProjectId): Promise<void> {
    // Cascade delete on health_profile_versions due to children constraint.
    await this.db.delete(healthProfiles).where(eq(healthProfiles.projectId, projectId));
  }

  /**
  * List all version IDs for a project.
  */
  async listVersions(projectId: ProjectId): Promise<string[]> {
    const rows = await this.db
      .select({ id: healthProfileVersions.id })
      .from(healthProfileVersions)
      .where(eq(healthProfileVersions.projectId, projectId))
      .orderBy(healthProfileVersions.createdAt);
    return rows.map((r) => r.id);
  }

  /**
  * Find all versions for a project, ordered by oldest first (ascending createdAt in health_profile_versions).
  */
  async findVersionsByProject(projectId: ProjectId): Promise<HealthProfile[]> {
    // Use join with health_profiles table (moved from health_profile_versions) to fetch all profile fields.
    const rows = await this.db
      .select()
      .from(healthProfiles)
      .where(eq(healthProfiles.projectId, projectId))
      .orderBy(healthProfiles.createdAt); // ascending (oldest first)
    return rows.map((r) => this.rowToProfile(r));
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
  * Translate a healthProfiles row to an in-memory HealthProfile.
  * projectId is numeric (project_id). Id is uuid (profile_id).
  */
  private rowToProfile(row: {
    id: string;
    projectId: number;
    schemaVersion: string;
    demographics: Record<string, unknown>;
    medicalHistory: Record<string, unknown>;
    currentSymptoms: Record<string, unknown>;
    medications: unknown[];
    lifestyle: Record<string, unknown>;
    customFields: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }): HealthProfile {
    return HealthProfile.reconstitute({
      id: row.id,
      tenantId: 0 as unknown as TenantId, // No tenant-level FK; assign placeholder (caller must not rely on it).
      projectId: asProjectId(row.projectId),
      schemaVersion: row.schemaVersion,
      demographics: row.demographics,
      medicalHistory: row.medicalHistory,
      currentSymptoms: row.currentSymptoms,
      medications: row.medications as unknown[],
      lifestyle: row.lifestyle,
      customFields: row.customFields,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}