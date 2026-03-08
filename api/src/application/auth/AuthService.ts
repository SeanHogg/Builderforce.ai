import { IUserRepository } from '../../domain/user/IUserRepository';
import { User } from '../../domain/user/User';
import { AuditEventType, UserId, asTenantId } from '../../domain/shared/types';
import { UnauthorizedError, ConflictError } from '../../domain/shared/errors';
import { signJwt, signWebJwt } from '../../infrastructure/auth/JwtService';
import { hashSecret, generateApiKey, hashPassword, verifyPassword } from '../../infrastructure/auth/HashService';
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

export interface WebRegisterDto {
  email:    string;
  username: string;
  password: string;
}

export interface WebLoginDto {
  email:    string;
  password: string;
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

export interface MyTenantsResult {
  tenants: Array<{
    id: number;
    name: string;
    slug: string;
    role: string;
    status: string;
    defaultClawId: number | null;
    plan: string;
    effectivePlan: string;
    billingStatus: string;
  }>;
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

    const apiKey = generateApiKey();
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
   * Pre-auth discovery: given a raw API key, return the tenants the user belongs to.
   * No JWT is issued – the caller uses the result to pick a tenant and then calls /token.
   */
  async myTenants(userId: string): Promise<MyTenantsResult> {
    const userTenants = await this.tenants.findByUserId(userId);
    return {
      tenants: userTenants.map(t => {
        const member = t.getMember(userId);
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          role: member?.role ?? 'member',
          status: t.status,
          defaultClawId: t.defaultClawId,
          plan: t.plan,
          effectivePlan: t.effectivePlan(),
          billingStatus: t.billingStatus,
        };
      }),
    };
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

  async registerWeb(dto: WebRegisterDto): Promise<WebLoginResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictError(`Email '${dto.email}' is already registered`);

    const existingUsername = await this.users.findByUsername(dto.username);
    if (existingUsername) throw new ConflictError(`Username '${dto.username}' is already taken`);

    const pwHash  = await hashPassword(dto.password);
    const apiKey  = generateApiKey();
    const keyHash = await hashSecret(apiKey);

    const user = await this.users.save(
      User.createWeb(dto.email, dto.username, pwHash, keyHash),
    );

    const expiresIn = 86_400;
    const token = await signWebJwt(
      { sub: user.id, email: user.email, username: user.username! },
      this.jwtSecret,
      expiresIn,
    );

    return {
      token,
      expiresIn,
      user: {
        id:           user.id,
        email:        user.email,
        username:     user.username!,
        displayName:  user.displayName,
        avatarUrl:    user.avatarUrl,
        bio:          user.bio,
        isSuperadmin: user.isSuperadmin,
      },
    };
  }

  async loginWeb(dto: WebLoginDto): Promise<WebLoginResult> {
    const user = await this.users.findByEmail(dto.email);
    if (!user || !user.passwordHash) throw new UnauthorizedError('Invalid email or password');

    const ok = await verifyPassword(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedError('Invalid email or password');

    const expiresIn = 86_400;
    // Embed sa: true in the token if this is a superadmin
    const token = await signWebJwt(
      {
        sub:      user.id,
        email:    user.email,
        username: user.username ?? '',
        ...(user.isSuperadmin ? { sa: true } : {}),
      },
      this.jwtSecret,
      expiresIn,
    );

    return {
      token,
      expiresIn,
      user: {
        id:           user.id,
        email:        user.email,
        username:     user.username ?? '',
        displayName:  user.displayName,
        avatarUrl:    user.avatarUrl,
        bio:          user.bio,
        isSuperadmin: user.isSuperadmin,
      },
    };
  }

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
