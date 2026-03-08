import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { legalDocuments, userLegalAcceptances } from '../../infrastructure/database/schema';

export async function getActiveTermsVersion(db: Db): Promise<string | null> {
  const [doc] = await db
    .select({ version: legalDocuments.version })
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.documentType, 'terms'),
        eq(legalDocuments.isActive, true),
      ),
    )
    .orderBy(desc(legalDocuments.publishedAt))
    .limit(1);

  return doc?.version ?? null;
}

export async function getAcceptedTermsVersion(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ version: userLegalAcceptances.version })
    .from(userLegalAcceptances)
    .where(
      and(
        eq(userLegalAcceptances.userId, userId),
        eq(userLegalAcceptances.documentType, 'terms'),
      ),
    )
    .limit(1);

  return row?.version ?? null;
}

export async function checkTermsAcceptance(
  db: Db,
  userId: string,
): Promise<{ requiredVersion: string | null; acceptedVersion: string | null; needsAcceptance: boolean }> {
  const requiredVersion = await getActiveTermsVersion(db);
  if (!requiredVersion) {
    return { requiredVersion: null, acceptedVersion: null, needsAcceptance: false };
  }

  const acceptedVersion = await getAcceptedTermsVersion(db, userId);
  const needsAcceptance = acceptedVersion !== requiredVersion;

  return { requiredVersion, acceptedVersion, needsAcceptance };
}
