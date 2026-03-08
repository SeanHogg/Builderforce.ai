import { eq, sql } from 'drizzle-orm';
import { IUserRepository } from '../../domain/user/IUserRepository';
import { User, UserProps } from '../../domain/user/User';
import { UserId } from '../../domain/shared/types';
import { users as usersTable } from '../database/schema';
import type { Db } from '../database/connection';

export class UserRepository implements IUserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: UserId): Promise<User | null> {
    const [row] = await this.db
      .select().from(usersTable)
      .where(eq(usersTable.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db
      .select().from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase())).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByApiKeyHash(hash: string): Promise<User | null> {
    const [row] = await this.db
      .select().from(usersTable)
      .where(eq(usersTable.apiKeyHash, hash)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const [row] = await this.db
      .select().from(usersTable)
      .where(eq(usersTable.username, username)).limit(1);
    return row ? toDomain(row) : null;
  }

  async save(user: User): Promise<User> {
    const plain = user.toPlain();
    const [inserted] = await this.db
      .insert(usersTable)
      .values({
        id:           plain.id,
        email:        plain.email,
        apiKeyHash:   plain.apiKeyHash,
        username:     plain.username     ?? null,
        displayName:  plain.displayName  ?? null,
        avatarUrl:    plain.avatarUrl    ?? null,
        bio:          plain.bio          ?? null,
        passwordHash: plain.passwordHash ?? null,
      })
      .returning();
    if (!inserted) throw new Error('User insert returned no rows');
    return toDomain(inserted);
  }

  async updateProfile(userId: UserId, updates: Partial<Pick<UserProps, 'displayName' | 'avatarUrl' | 'bio' | 'username'>>): Promise<User> {
    const setFields: Record<string, unknown> = { updatedAt: sql`now()` };
    if (updates.displayName !== undefined) setFields.displayName = updates.displayName;
    if (updates.avatarUrl   !== undefined) setFields.avatarUrl   = updates.avatarUrl;
    if (updates.bio         !== undefined) setFields.bio         = updates.bio;
    if (updates.username    !== undefined) setFields.username    = updates.username;
    const [updated] = await this.db
      .update(usersTable)
      .set(setFields)
      .where(eq(usersTable.id, userId))
      .returning();
    if (!updated) throw new Error('User not found');
    return toDomain(updated);
  }
}

function toDomain(row: typeof usersTable.$inferSelect): User {
  return User.reconstitute({
    id:            row.id as UserProps['id'],
    email:         row.email,
    apiKeyHash:    row.apiKeyHash,
    username:      row.username     ?? null,
    displayName:   row.displayName  ?? null,
    avatarUrl:     row.avatarUrl    ?? null,
    bio:           row.bio          ?? null,
    passwordHash:  row.passwordHash ?? null,
    isSuperadmin:  row.isSuperadmin ?? false,
    createdAt:     row.createdAt,
    updatedAt:     row.updatedAt,
  });
}

