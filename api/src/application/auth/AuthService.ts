import { IUserRepository } from '../../domain/user/IUserRepository';
import { User } from '../../domain/user/User';
import { AuditEventType, UserId, asTenantId } from '../../domain/shared/types';
import { UnauthorizedError, ConflictError, ForbiddenError } from '../../domain/shared/errors';
import { signJwt } from '../../infrastructure/auth/JwtService';
import { hashSecret, generateApiKey } from '../../infrastructure/auth/HashService';
import { IAuditRepository } from '../../domain/audit/IAuditRepository';
import { AuditEvent } from '../../domain/audit/AuditEvent';
import { ITenantRepository } from '../../domain/tenant/ITenantRepository';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface RegisterDto {
  email:    string;
  tenantId: number;
}

export interface RegisterResult {
  user:   { id: string; email: string };
  apiKey: string; // shown once — plaintext
}

export interface LoginResult {
  token:     string;
  expiresIn: number;
}

export interface WebLoginResult {
  token:     string;
  expiresIn: number;
  user: {
    id:           string;
    email:        string;
    username:     string;
    displayName:  string | null;
    avatarUrl:    string | null;
    bio:          string | null;
    isSuperadmin: boolean;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuthService {
  constructor(
    private readonly users:     IUserRepository,
    private readonly tenants:   ITenantRepository,
    private readonly audit:     IAuditRepository,
    private readonly jwtSecret: string,
  ) {}

  // -- API key path ----------------------------------------------------------

  async register(dto: RegisterDto): Promise<RegisterResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictError(`Email '${dto.email}' is already registered`);

    const tenant = await this.tenants.findById(asTenantId(dto.tenantId));
    if (!tenant) throw new UnauthorizedError('Tenant not found');

    const apiKey = generateApiKey('clu');
    const hash   = await hashSecret(apiKey);
    const user   = await this.users.save(User.create(dto.email, hash));

    await this.audit.save(AuditEvent.create({
      tenantId:     asTenantId(dto.tenantId),
      userId:       user.id,
      eventType:    AuditEventType.USER_REGISTERED,
      resourceType: 'user',
      resourceId:   user.id,
      metadata:     null,
    }));

    return { user: { id: user.id, email: user.email }, apiKey };
  }

  async login(rawApiKey: string, tenantId: number): Promise<LoginResult> {
    const hash = await hashSecret(rawApiKey);
    const user = await this.users.findByApiKeyHash(hash);
    if (!user) throw new UnauthorizedError('Invalid API key');

    const tenant = await this.tenants.findById(asTenantId(tenantId));
    if (!tenant) throw new UnauthorizedError('Tenant not found');

    const member = tenant.getMember(user.id);
    if (!member) throw new UnauthorizedError('User is not a member of this tenant');

    const expiresIn = 3600;
    const token = await signJwt(
      { sub: user.id, tid: tenantId, role: member.role },
      this.jwtSecret,
      expiresIn,
    );

    await this.audit.save(AuditEvent.create({
      tenantId:     asTenantId(tenantId),
      userId:       user.id,
      eventType:    AuditEventType.USER_LOGIN,
      resourceType: 'user',
      resourceId:   user.id,
      metadata:     null,
    }));

    return { token, expiresIn };
  }

  // -- Web / marketplace path ------------------------------------------------

  /**
   * Set (or clear, with null) the workspace this user opens automatically. Only a
   * workspace they belong to can be their default.
   */
  async setDefaultTenant(userId: string, tenantId: number | null): Promise<void> {
    if (tenantId !== null) {
      const tenant = await this.tenants.findById(asTenantId(tenantId));
      if (!tenant?.getMember(userId)) throw new ForbiddenError('User is not a member of this tenant');
    }
    await this.users.setDefaultTenantId(userId as UserId, tenantId);
  }

  /**
   * Issue a tenant-scoped JWT for a web user who has already authenticated.
   * The web JWT is validated upstream; here we just verify membership.
   */
  async tenantToken(userId: string, tenantId: number, sessionId?: string): Promise<LoginResult> {
    const tenant = await this.tenants.findById(asTenantId(tenantId));
    if (!tenant) throw new UnauthorizedError('Tenant not found');

    const member = tenant.getMember(userId);
    if (!member) throw new UnauthorizedError('User is not a member of this tenant');

    const expiresIn = 3600;
    const token = await signJwt(
      { sub: userId, tid: tenantId, role: member.role, sid: sessionId },
      this.jwtSecret,
      expiresIn,
    );
    return { token, expiresIn };
  }

  // Web register / login are NOT here. They live in ONE place —
  // `POST /api/auth/web/{register,login}` — because the real flow needs terms
  // acceptance, the 18+ attestation, email verification, suspension, MFA and a
  // persisted session row. The weaker copies that used to sit here had none of
  // that and no callers; `/marketplace/auth/*` now aliases the canonical routes.

  async getMe(userId: UserId): Promise<WebLoginResult['user'] | null> {
    const user = await this.users.findById(userId);
    if (!user) return null;
    return {
      id:           user.id,
      email:        user.email,
      username:     user.username ?? '',
      displayName:  user.displayName,
      avatarUrl:    user.avatarUrl,
      bio:          user.bio,
      isSuperadmin: user.isSuperadmin,
    };
  }
}
