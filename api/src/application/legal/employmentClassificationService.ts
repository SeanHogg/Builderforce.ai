/**
 * Employment Classification Service
 *
 * Defines and manages employment classifications and associated compliance disclosures
 * for engagements. Supports internal Legal & Compliance teams and auditors.
 *
 * FR1: Classification Definition - Allow internal teams to define employment classifications
 * FR2: Disclosure Configuration - Associate compliance-mandated disclosures with each classification
 */
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { db } from '../../infrastructure/database/connection';
import {
  employmentClassifications,
  employmentClassificationDisclosures,
  engagementClassifications,
  engagementDisclosureAcknowledgements,
} from '../../infrastructure/database/schema';
import type { TenantId } from '../../types';
import { DatabaseError } from '../../infrastructure/database/errors';

export const EmploymentClassificationStatus = {
  ACTIVE: 'active',
  DRAFT: 'draft',
  DEPRECATED: 'deprecated',
} as const;

export type EmploymentClassificationStatusType = (typeof EmploymentClassificationStatus)[keyof typeof EmploymentClassificationStatus];

export const DisclosureStatus = {
  PENDING: 'pending',
  ACKNOWLEDGED: 'acknowledged',
  DECLINED: 'declined',
} as const;

export type DisclosureStatusType = (typeof DisclosureStatus)[keyof typeof DisclosureStatus];

export interface EmploymentClassification {
  id?: number;
  tenantId: TenantId;
  name: string;
  slug: string; // e.g., "full-time_employee"
  description: string;
  status: EmploymentClassificationStatusType;
  defaultDisclosures?: string[] | null; // JSON.stringify array of disclosure IDs
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComplianceDisclosure {
  id?: number;
  classificationId: number | null; // null = system-defined
  tenantId: TenantId;
  title: string;
  type: 'text' | 'link' | 'section';
  content: string; // plain text or URL
  contentLanguage: string; // ISO 639-1
  required: boolean;
  order: number;
  systemDefined: boolean; // false = defined by tenant
  createdAt: Date;
  updatedAt: Date;
}

export interface EngagementClassification {
  id?: number;
  engagementId: number; // Linked to engagements table
  employmentClassificationId: number; // Reference to employmentClassifications
  assignedBy?: string | null; // User ID or agent ref
  assignedAt: Date;
  notes?: string | null;
}

export interface EngagementDisclosureAcknowledgement {
  id?: number;
  tenantId: TenantId;
  engagementId: number;
  disclosureId: number;
  classificationId: number;
  acknowledgedBy?: string | null;
  acknowledgedAt: Date;
  status: DisclosureStatusType;
}

export interface ClassificationWithDisclosures extends EmploymentClassification {
  disclosures: ComplianceDisclosure[];
}

export interface EngagementWithClassifications {
  id: number;
  clientUserId: string;
  freelancerUserId: string;
  engagementType: string;
  employmentClassificationId?: number;
  classification?: EmploymentClassification;
  disclosures: ComplianceDisclosure[];
  acknowledgements: EngagementDisclosureAcknowledgement[];
}

export interface ClassificationDisclosureAssignment {
  classification: EmploymentClassification;
  disclosures: ComplianceDisclosure[];
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type CreateClassificationInput = Omit<EmploymentClassification, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateClassificationInput = Partial<CreateClassificationInput>;
export type CreateDisclosureInput = Omit<ComplianceDisclosure, 'id' | 'createdAt' | 'updatedAt' | 'systemDefined'>;

export class EmploymentClassificationService {
  private static instance: EmploymentClassificationService;

  private constructor() {}

  /** Create a singleton instance ensuring thread safety */
  public static getInstance(): EmploymentClassificationService {
    if (!EmploymentClassificationService.instance) {
      EmploymentClassificationService.instance = new EmploymentClassificationService();
    }
    return EmploymentClassificationService.instance;
  }

  /**
   * FR1: Create or update an employment classification.
   * Classifications are defined by Legal & Compliance teams.
   */
  async upsertClassification(
    input: CreateClassificationInput
  ): Promise<EmploymentClassification> {
    try {
      const slug = this.normalizeSlug(input.slug);
      
      // Check if this tenant already has a classification with this slug
      const existing = await db
        .select({
          id: employmentClassifications.id,
        })
        .from(employmentClassifications)
        .where(
          and(
            eq(employmentClassifications.tenantId, input.tenantId),
            eq(employmentClassifications.slug, slug),
            eq(employmentClassifications.systemDefined, false) // Custom only
          )
        )
        .limit(1);

      const now = new Date();

      if (existing.length > 0) {
        // Update existing
        const [updated] = await db
          .update(employmentClassifications)
          .set({
            name: input.name,
            description: input.description,
            status: 'draft', // Draft until approved by legal team
            metadata: input.metadata ?? null,
            updatedAt: now,
          })
          .where(eq(employmentClassifications.id, existing[0].id!))
          .returning();

        return {
          ...updated!,
          defaultDisclosures: input.defaultDisclosures
            ? JSON.stringify(input.defaultDisclosures)
            : null,
        };
      } else {
        // Create new
        const [inserted] = await db
          .insert(employmentClassifications)
          .values({
            tenantId: input.tenantId,
            name: input.name,
            slug,
            description: input.description,
            status: 'draft',
            defaultDisclosures: input.defaultDisclosures
              ? JSON.stringify(input.defaultDisclosures)
              : null,
            metadata: input.metadata ?? null,
            systemDefined: false, // User-defined
          })
          .returning();

        return {
          ...inserted!,
          defaultDisclosures: input.defaultDisclosures
            ? JSON.stringify(input.defaultDisclosures)
            : null,
        };
      }
    } catch (error) {
      console.error('Error upserting employment classification:', error);
      throw new DatabaseError('Failed to upsert employment classification', error);
    }
  }

  /**
   * Fetch all classifications for a tenant (filtered by status by default)
   */
  async getClassifications(
    tenantId: TenantId,
    options?: {
      status?: EmploymentClassificationStatusType;
      limit?: number;
      offset?: number;
    }
  ): Promise<PaginatedResult<EmploymentClassification>> {
    try {
      const {
        status = EmploymentClassificationStatus.ACTIVE,
        limit = 50,
        offset = 0,
      } = options || {};

      const conditions = [
        eq(employmentClassifications.tenantId, tenantId),
        eq(employmentClassifications.systemDefined, false), // Only user-defined
      ];
      if (status !== undefined) {
        conditions.push(eq(employmentClassifications.status, status));
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(employmentClassifications)
        .where(and(...conditions));
      const total = Number(countResult?.count ?? 0);

      // Fetch paginated results
      const results = await db
        .select()
        .from(employmentClassifications)
        .where(and(...conditions))
        .orderBy(asc(employmentClassifications.name))
        .limit(limit)
        .offset(offset);

      const items = results.map((r) => ({
        ...r,
        defaultDisclosures: r.defaultDisclosures
          ? JSON.parse(r.defaultDisclosures)
          : undefined,
      }));

      return {
        items,
        total,
        limit,
        offset,
      };
    } catch (error) {
      console.error('Error fetching classifications:', error);
      throw new DatabaseError('Failed to fetch classifications', error);
    }
  }

  /**
   * Get a single classification by ID with its disclosures
   */
  async getClassificationWithDisclosures(
    tenantId: TenantId,
    classificationId: number
  ): Promise<ClassificationWithDisclosures | null> {
    try {
      const [classification] = await db
        .select()
        .from(employmentClassifications)
        .where(
          and(
            eq(employmentClassifications.id, classificationId),
            eq(employmentClassifications.tenantId, tenantId),
            eq(employmentClassifications.systemDefined, false)
          )
        )
        .limit(1);

      if (!classification) {
        return null;
      }

      const disclosures = await this.getDisclosuresByClassification(id);
      const parsedDefaultDisclosures = classification.defaultDisclosures
        ? JSON.parse(classification.defaultDisclosures)
        : [];

      return {
        ...classification,
        disclosures,
        defaultDisclosures: parsedDefaultDisclosures,
      };
    } catch (error) {
      console.error('Error fetching classification with disclosures:', error);
      throw new DatabaseError('Failed to fetch classification with disclosures', error);
    }
  }

  // Inline reference to this class for internal method calls
  private getDisclosuresByClassification(classificationId: number): Promise<ComplianceDisclosure[]> {
    return db
      .select()
      .from(employmentClassificationDisclosures)
      .where(eq(employmentClassificationDisclosures.classificationId, classificationId))
      .orderBy(asc(employmentClassificationDisclosures.order));
  }

  /**
   * FR2: Create a compliance disclosure for a classification
   */
  async upsertDisclosure(
    input: CreateDisclosureInput
  ): Promise<ComplianceDisclosure> {
    try {
      // If classificationId is provided, ensure classification exists and belongs to tenant
      if (input.classificationId) {
        const [existing] = await db
          .select()
          .from(employmentClassifications)
          .where(
            and(
              eq(employmentClassifications.id, input.classificationId!),
              eq(employmentClassifications.tenantId, input.tenantId),
              eq(employmentClassifications.systemDefined, false)
            )
          )
          .limit(1);

        if (!existing) {
          throw new DatabaseError('Classification not found', undefined);
        }
      }

      const now = new Date();
      const [inserted] = await db
        .insert(employmentClassificationDisclosures)
        .values({
          classificationId: input.classificationId ?? null,
          tenantId: input.tenantId,
          title: input.title,
          type: input.type,
          content: input.content,
          contentLanguage: input.contentLanguage || 'en',
          required: input.required ?? true,
          order: input.order ?? 0,
          systemDefined: input.systemDefined ?? false,
        })
        .returning();

      return {
        ...inserted!,
        updatedAt: now,
      };
    } catch (error) {
      console.error('Error upserting disclosure:', error);
      throw new DatabaseError('Failed to upsert disclosure', error);
    }
  }

  /**
   * Get all disclosures for a classification
   */
  async getDisclosuresByClassification(
    classificationId: number,
    tenantId?: TenantId
  ): Promise<ComplianceDisclosure[]> {
    try {
      const conditions = [eq(employmentClassificationDisclosures.classificationId, classificationId)];
      if (tenantId) {
        conditions.push(eq(employmentClassificationDisclosures.tenantId, tenantId));
      }

      const results = await db
        .select()
        .from(employmentClassificationDisclosures)
        .where(and(...conditions))
        .orderBy(asc(employmentClassificationDisclosures.order));

      return results;
    } catch (error) {
      console.error('Error fetching disclosures:', error);
      throw new DatabaseError('Failed to fetch disclosures', error);
    }
  }

  /**
   * FR3: Assign an employment classification to an engagement
   * This happens when a new engagement is created
   */
  async assignClassificationToEngagement(
    engagementId: number,
    employmentClassificationId: number,
    assignedBy?: string | null
  ): Promise<EngagementClassification> {
    try {
      // Validate classification belongs to the same tenant (enforced by tenantId FK already)
      const [existing] = await db
        .select()
        .from(employmentClassifications)
        .where(eq(employmentClassifications.id, employmentClassificationId))
        .limit(1);

      if (!existing) {
        throw new DatabaseError('Employment classification not found', undefined);
      }

      const [inserted] = await db
        .insert(engagementClassifications)
        .values({
          engagementId,
          employmentClassificationId,
          assignedBy,
          assignedAt: new Date(),
        })
        .returning();

      return inserted!;
    } catch (error) {
      console.error('Error assigning classification to engagement:', error);
      throw new DatabaseError('Failed to assign classification to engagement', error);
    }
  }

  /**
   * Get the classification for an engagement (if any)
   */
  async getEngagementClassification(
    tenantId: TenantId,
    engagementId: number
  ): Promise<EngagementWithClassifications | null> {
    try {
      // Fetch engagement classification assignment
      const assignment = await db
        .select({
          id: engagementClassifications.id,
          employmentClassificationId: engagementClassifications.employmentClassificationId,
          assignedBy: engagementClassifications.assignedBy,
          assignedAt: engagementClassifications.assignedAt,
        })
        .from(engagementClassifications)
        .where(eq(engagementClassifications.engagementId, engagementId))
        .limit(1);

      if (!assignment) {
        return null;
      }

      // Fetch entitlements for the engagement
      const [engagement] = await db
        .select({
          id: db.$customType<Pick<EngagementWithClassifications, 'id'>>('int'),
          clientUserId: db.$customType<'text'>('text'),
          freelancerUserId: db.$customType<'text'>('text'),
          engagementType: db.$customType<'text'>('text'),
        })
        .from(engagements) // Need to verify this table exists
        .where(eq(engagements.id, engagementId))
        .limit(1);

      if (!engagement) {
        return null;
      }

      // Fetch classification with disclosures
      const classification = await this.getClassificationWithDisclosures(
        tenantId,
        assignment.employmentClassificationId!
      );

      if (!classification) {
        return null;
      }

      // Fetch acknowledgements for this engagement
      const [ackCountResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(engagementDisclosureAcknowledgements)
        .where(eq(engagementDisclosureAcknowledgements.engagementId, engagementId));
      const totalAck = Number(ackCountResult?.count ?? 0);

      const [requiredAckResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(engagementDisclosureAcknowledgements)
        .where(
          and(
            eq(engagementDisclosureAcknowledgements.engagementId, engagementId),
            eq(engagementDisclosureAcknowledgements.status, DisclosureStatus.ACKNOWLEDGED)
          )
        );
      const requiredAck = Number(requiredAckResult?.count ?? 0);

      const disclosures = classification.disclosures;
      const acknowledgements = disclosures
        .filter((d) => required)
        .map((d) => ({
          ...d,
          acknowledged: requiredAck > 0,
          acknowledgedBy: null, // Full detail would query engagementDisclosureAcknowledgements
          acknowledgedAt: null,
        }));

      return {
        id: engagement.id!,
        clientUserId: engagement.clientUserId,
        freelancerUserId: engagement.freelancerUserId,
        engagementType: engagement.engagementType,
        employmentClassificationId: employmentClassificationId,
        classification,
        disclosures,
        acknowledgements,
      };
    } catch (error) {
      console.error('Error fetching engagement classification:', error);
      throw new DatabaseError('Failed to fetch engagement classification', error);
    }
  }

  /**
   * FR6: Record disclosure acknowledgement
   */
  async acknowledgeDisclosure(
    tenantId: TenantId,
    engagementId: number,
    disclosureId: number,
    acknowledgedBy?: string | null
  ): Promise<EngagementDisclosureAcknowledgement> {
    try {
      // Validate disclosure exists and belongs to engagement's classification
      const [disclosure] = await db
        .select()
        .from(employmentClassificationDisclosures)
        .where(eq(employmentClassificationDisclosures.id, disclosureId))
        .limit(1);

      if (!disclosure) {
        throw new DatabaseError('Disclosure not found', undefined);
      }

      // Check if classification is assigned to this engagement
      const hasClassification = await db
        .select()
        .from(engagementClassifications)
        .where(
          and(
            eq(engagementClassifications.engagementId, engagementId),
            eq(engagementClassifications.employmentClassificationId, disclosure.classificationId)
          )
        )
        .limit(1);

      if (hasClassification.length === 0) {
        throw new DatabaseError('Disclosure not assigned to this engagement', undefined);
      }

      // Upsert acknowledgement
      const now = new Date();
      const [inserted] = await db
        .insert(engagementDisclosureAcknowledgements)
        .values({
          tenantId,
          engagementId,
          disclosureId,
          classificationId: disclosure.classificationId!,
          acknowledgedBy,
          acknowledgedAt: now,
          status: DisclosureStatus.ACKNOWLEDGED,
        })
        .onConflictDoUpdate({
          target: [
            engagementDisclosureAcknowledgements.engagementId,
            engagementDisclosureAcknowledgements.disclosureId,
          ],
          set: {
            acknowledgedBy,
            acknowledgedAt: now,
            status: DisclosureStatus.ACKNOWLEDGED,
            updatedAt: now,
          },
        })
        .returning();

      return inserted!;
    } catch (error) {
      console.error('Error acknowledging disclosure:', error);
      throw new DatabaseError('Failed to acknowledge disclosure', error);
    }
  }

  /**
   * Check which disclosures are pending acknowledgement
   */
  async getPendingDisclosures(tenantId: TenantId, engagementId: number): Promise<ComplianceDisclosure[]> {
    try {
      const disclosures = await db
        .select({
          disc: employmentClassificationDisclosures,
          ack: engagementDisclosureAcknowledgements,
        })
        .from(employmentClassificationDisclosures)
        .leftJoin(
          engagementDisclosureAcknowledgements,
          and(
            eq(engagementDisclosureAcknowledgements.engagementId, engagementId),
            eq(engagementDisclosureAcknowledgements.disclosureId, employmentClassificationDisclosures.id)
          )
        )
        .where(
          and(
            eq(employmentClassificationDisclosures.tenantId, tenantId),
            eq(employmentDisclosureAcknowledgements.status, null)
          )
        );

      return disclosures.map((d) => ({
        ...d.disc,
        updatedAt: d.disc.updatedAt,
      })).filter(Boolean) as ComplianceDisclosure[];
    } catch (error) {
      console.error('Error fetching pending disclosures:', error);
      throw new DatabaseError('Failed to fetch pending disclosures', error);
    }
  }

  /**
   * Normalize the slug to ensure consistency (lowercase, hyphens, alphanumeric only)
   */
  private normalizeSlug(slug: string): string {
    return slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  /**
   * FR5: Clients and freelancers can view their classifications and disclosures
   * Public route for client/freelancer apps
   */
  async getPublicEngagementClassification(
    engagementId: number,
    tenantId: TenantId
  ): Promise<EngagementWithClassifications | null> {
    return this.getEngagementClassification(tenantId, engagementId);
  }
}