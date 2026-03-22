# Multi-Auth Implementation Guide

A complete reference for implementing email/password, OAuth social login, and magic link authentication in a Hono + Cloudflare Workers + Drizzle ORM + React SPA stack. Every pattern here is derived from a working production implementation.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [Password Authentication](#password-authentication)
4. [OAuth Social Login](#oauth-social-login)
5. [Magic Links](#magic-links)
6. [JWT Token Strategy](#jwt-token-strategy)
7. [Frontend Integration](#frontend-integration)
8. [Account Management](#account-management)
9. [Security Checklist](#security-checklist)
10. [Environment Variables](#environment-variables)
11. [Provider Setup](#provider-setup)

---

## Architecture Overview

```
Browser
  │
  ├─ Email/Password ──────────────────────────────▶ POST /api/auth/login
  │                                                  Returns JWT in JSON body
  │
  ├─ OAuth (click button) ────────────────────────▶ GET /api/auth/oauth/:provider
  │                                                  302 → provider consent screen
  │                                                  Provider → GET /api/auth/oauth/:provider/callback
  │                                                  API issues JWT
  │                                                  302 → /auth/callback?token=JWT
  │                                                  Frontend page writes token to localStorage
  │
  └─ Magic Link ──────────────────────────────────▶ POST /api/auth/magic-link
                                                     Email sent with /auth/magic-link?token=...
                                                     Frontend page calls GET /api/auth/magic-link/verify
                                                     Returns JWT in JSON body
```

**Key design decisions:**

- JWT stored in `localStorage` (not HttpOnly cookies) — required if you also support a browser extension or non-browser clients that share the same API
- OAuth state is HMAC-signed (no DB) — works correctly in stateless edge runtimes
- `passwordHash` is nullable — users who sign up via OAuth have no password
- Magic link tokens are single-use and invalidated immediately on verify
- All "not found" paths return the same generic message to prevent email enumeration

---

## Database Schema

### Core users table

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) NOT NULL UNIQUE,
  name            VARCHAR(255) NOT NULL,
  password_hash   TEXT,                         -- NULL for OAuth-only users
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  role            VARCHAR(50)  NOT NULL DEFAULT 'job_seeker',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_suspended    BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### OAuth accounts (one user → many providers)

```sql
CREATE TABLE oauth_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            VARCHAR(50)  NOT NULL,   -- 'google' | 'linkedin' | 'github' | 'microsoft'
  provider_account_id VARCHAR(255) NOT NULL,   -- the `sub` or `id` from the provider
  email               VARCHAR(255),
  display_name        VARCHAR(255),
  avatar_url          TEXT,
  access_token        TEXT,
  refresh_token       TEXT,
  token_expires_at    TIMESTAMPTZ,
  scope               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Magic link tokens

```sql
CREATE TABLE magic_link_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      VARCHAR(255) NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  redirect   VARCHAR(500) NOT NULL DEFAULT '/dashboard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Supporting tables (also needed)

```sql
-- Tracks active sessions; populated on every login
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email verification tokens
CREATE TABLE email_verification_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TOTP / email 2FA codes
CREATE TABLE two_factor_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       VARCHAR(10) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Password Authentication

### Hashing — PBKDF2 via Web Crypto API

Works natively in Cloudflare Workers (no bcrypt npm dependency needed).

```typescript
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;           // OAuth-only accounts have no password
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const candidateHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  return candidateHex === hashHex;
}
```

> **Note:** Always return the same error message for wrong email AND wrong password — `"Invalid email or password"`. Never leak which one was wrong.

### Login endpoint

```typescript
// POST /api/auth/login
app.post("/login", async (c) => {
  const { email, password } = await c.req.json();

  const [user] = await db.select().from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user || !user.isActive) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Optional: 2FA step (see auth.ts)

  const token = await createJwt(user.id, user.email, user.role, !!user.emailVerified);
  return c.json({ token, user: { id: user.id, email: user.email } });
});
```

---

## OAuth Social Login

### How it works

```
1. User clicks "Sign in with Google"
2. Frontend redirects to: GET /api/auth/oauth/google?redirect=/dashboard
3. API builds provider authorization URL with HMAC-signed state, redirects browser
4. User authenticates with Google
5. Google redirects to: GET /api/auth/oauth/google/callback?code=...&state=...
6. API verifies state, exchanges code for access token, fetches user profile
7. API upserts user + oauth_accounts row
8. API issues JWT, redirects to: /auth/callback?token=JWT&redirect=/dashboard
9. Frontend /auth/callback page calls loginWithToken(token), then navigates
```

### HMAC-signed state (no DB required)

Protects against CSRF without needing session storage — critical for stateless edge runtimes.

```typescript
async function createOAuthState(redirect: string): Promise<string> {
  const secret = getEnv("JWT_SECRET");
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const payload = JSON.stringify({ nonce, redirect: redirect || "/dashboard", ts: Date.now() });

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  return btoa(payload + "|" + sigHex);
}

async function verifyOAuthState(state: string): Promise<{ redirect: string } | null> {
  try {
    const secret = getEnv("JWT_SECRET");
    const decoded = atob(state);
    const sepIdx = decoded.lastIndexOf("|");
    const payload = decoded.slice(0, sepIdx);
    const sigHex = decoded.slice(sepIdx + 1);

    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));

    if (!valid) return null;
    const { redirect, ts } = JSON.parse(payload);
    if (Date.now() - ts > 10 * 60 * 1000) return null;   // 10-minute window
    return { redirect };
  } catch {
    return null;
  }
}
```

### Provider configuration

```typescript
interface ProviderCfg {
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  clientId: () => string;
  clientSecret: () => string;
  parseUser: (d: any) => { id: string; email: string; name: string; avatar?: string };
  extraAuthParams?: Record<string, string>;
}

const PROVIDERS: Record<string, ProviderCfg> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scopes: ["openid", "email", "profile"],
    clientId: () => getEnv("GOOGLE_CLIENT_ID"),
    clientSecret: () => getEnv("GOOGLE_CLIENT_SECRET"),
    extraAuthParams: { access_type: "offline", prompt: "select_account" },
    parseUser: (d) => ({ id: d.sub, email: d.email, name: d.name ?? d.email, avatar: d.picture }),
  },
  linkedin: {
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    userInfoUrl: "https://api.linkedin.com/v2/userinfo",   // OpenID Connect endpoint
    scopes: ["openid", "profile", "email"],
    clientId: () => getEnv("LINKEDIN_CLIENT_ID"),
    clientSecret: () => getEnv("LINKEDIN_CLIENT_SECRET"),
    parseUser: (d) => ({
      id: d.sub,
      email: d.email,
      name: d.name ?? (`${d.given_name ?? ""} ${d.family_name ?? ""}`.trim() || d.email),
      avatar: d.picture,
    }),
  },
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: ["read:user", "user:email"],
    clientId: () => getEnv("GITHUB_CLIENT_ID"),
    clientSecret: () => getEnv("GITHUB_CLIENT_SECRET"),
    parseUser: (d) => ({
      id: String(d.id),
      email: d.email ?? "",
      name: d.name ?? d.login ?? d.email,
      avatar: d.avatar_url,
    }),
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    scopes: ["openid", "profile", "email", "User.Read"],
    clientId: () => getEnv("MICROSOFT_CLIENT_ID"),
    clientSecret: () => getEnv("MICROSOFT_CLIENT_SECRET"),
    parseUser: (d) => ({
      id: d.id,
      email: d.mail ?? d.userPrincipalName ?? "",
      name: d.displayName ?? d.mail,
    }),
  },
};
```

> **GitHub gotcha:** GitHub may not return email in `/user` if the user has set it private. Always call `/user/emails` as a fallback:
>
> ```typescript
> async function getGitHubEmail(accessToken: string): Promise<string> {
>   const res = await fetch("https://api.github.com/user/emails", {
>     headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
>   });
>   if (!res.ok) return "";
>   const emails = await res.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
>   return emails.find(e => e.primary && e.verified)?.email ?? emails[0]?.email ?? "";
> }
> ```

### Initiate route

```typescript
// GET /api/auth/oauth/:provider
app.get("/:provider", async (c) => {
  const name = c.req.param("provider").toLowerCase();
  const cfg = PROVIDERS[name];
  if (!cfg || !cfg.clientId()) return c.json({ error: "Provider not available" }, 503);

  const redirect = c.req.query("redirect") || "/dashboard";
  const state = await createOAuthState(redirect);
  const callbackUrl = `${getEnv("API_URL")}/api/auth/oauth/${name}/callback`;

  const params = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: cfg.scopes.join(" "),
    state,
    ...cfg.extraAuthParams,
  });

  return c.redirect(`${cfg.authUrl}?${params.toString()}`);
});
```

### Callback route — upsert user, issue JWT

```typescript
// GET /api/auth/oauth/:provider/callback
app.get("/:provider/callback", async (c) => {
  const name = c.req.param("provider").toLowerCase();
  const cfg = PROVIDERS[name];
  const frontendBase = getEnv("FRONTEND_URL").split(",")[0].trim();

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.redirect(`${frontendBase}/login?error=missing_params`);

  const stateData = await verifyOAuthState(state);
  if (!stateData) return c.redirect(`${frontendBase}/login?error=invalid_state`);

  const callbackUrl = `${getEnv("API_URL")}/api/auth/oauth/${name}/callback`;

  let tokens, providerUser;
  try {
    tokens = await exchangeCode(cfg, code, callbackUrl);
    const raw = await fetchUserInfo(cfg, tokens.access_token);
    providerUser = cfg.parseUser(raw);
    if (name === "github" && !providerUser.email) {
      providerUser.email = await getGitHubEmail(tokens.access_token);
    }
  } catch {
    return c.redirect(`${frontendBase}/login?error=auth_failed`);
  }

  if (!providerUser.email) return c.redirect(`${frontendBase}/login?error=no_email`);

  // 1. Check if this provider account is already linked
  const [existingOAuth] = await db.select().from(oauthAccounts)
    .where(and(
      eq(oauthAccounts.provider, name),
      eq(oauthAccounts.providerAccountId, providerUser.id)
    )).limit(1);

  let userId: string;

  if (existingOAuth) {
    // Known provider account — update tokens, get userId
    userId = existingOAuth.userId;
    await db.update(oauthAccounts).set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      updatedAt: new Date(),
    }).where(eq(oauthAccounts.id, existingOAuth.id));
  } else {
    // 2. Check if user exists with same email (account linking)
    const [existing] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, providerUser.email.toLowerCase())).limit(1);

    if (existing) {
      userId = existing.id;
    } else {
      // 3. Create new user — email is pre-verified via OAuth
      const [newUser] = await db.insert(users).values({
        email: providerUser.email.toLowerCase(),
        name: providerUser.name,
        passwordHash: null,   // no password for OAuth-only users
        emailVerified: true,
        role: "job_seeker",
      }).returning({ id: users.id });
      userId = newUser.id;
    }

    // 4. Link the OAuth account
    await db.insert(oauthAccounts).values({
      userId,
      provider: name,
      providerAccountId: providerUser.id,
      email: providerUser.email.toLowerCase(),
      displayName: providerUser.name,
      avatarUrl: providerUser.avatar ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
    });
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive || user.isSuspended) {
    return c.redirect(`${frontendBase}/login?error=account_disabled`);
  }

  const jwt = await createJwt(user.id, user.email, user.role, true);
  return c.redirect(
    `${frontendBase}/auth/callback?token=${encodeURIComponent(jwt)}&redirect=${encodeURIComponent(stateData.redirect)}`
  );
});
```

---

## Magic Links

### Send endpoint

```typescript
// POST /api/auth/magic-link
app.post("/magic-link", async (c) => {
  const { email, redirect = "/dashboard" } = await c.req.json();
  const normalizedEmail = email.toLowerCase().trim();

  const [user] = await db.select({ id: users.id, name: users.name, isActive: users.isActive })
    .from(users).where(eq(users.email, normalizedEmail)).limit(1);

  // Always return 200 — never reveal whether the email exists
  if (user?.isActive) {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    // Invalidate any existing unused tokens for this email
    await db.update(magicLinkTokens)
      .set({ used: true })
      .where(and(eq(magicLinkTokens.email, normalizedEmail), eq(magicLinkTokens.used, false)));

    await db.insert(magicLinkTokens).values({
      email: normalizedEmail,
      token,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),  // 15 minutes
      redirect,
    });

    // Fire-and-forget in Cloudflare Workers
    c.executionCtx.waitUntil(
      sendMagicLinkEmail(normalizedEmail, user.name, token)
    );
  }

  return c.json({ message: "If an account exists for that email, a sign-in link has been sent" });
});
```

### Verify endpoint

```typescript
// GET /api/auth/magic-link/verify?token=...
app.get("/magic-link/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: "Token required" }, 400);

  const [row] = await db.select().from(magicLinkTokens)
    .where(and(eq(magicLinkTokens.token, token), eq(magicLinkTokens.used, false)))
    .limit(1);

  if (!row || row.expiresAt <= new Date()) {
    return c.json({ error: "Magic link is invalid or has expired" }, 400);
  }

  // Mark used immediately — single use
  await db.update(magicLinkTokens).set({ used: true }).where(eq(magicLinkTokens.id, row.id));

  const [user] = await db.select().from(users)
    .where(eq(users.email, row.email)).limit(1);

  if (!user || !user.isActive || user.isSuspended) {
    return c.json({ error: "Account not found or disabled" }, 401);
  }

  const jwt = await createJwt(user.id, user.email, user.role, !!user.emailVerified);
  return c.json({
    token: jwt,
    user: { id: user.id, email: user.email, name: user.name },
    redirect: row.redirect || "/dashboard",
  });
});
```

### Email template

The magic link email should include:
- A large, prominent CTA button linking to: `{FRONTEND_URL}/auth/magic-link?token={token}`
- Token expiry warning (e.g., "This link expires in 15 minutes")
- Plain-text fallback URL below the button

---

## JWT Token Strategy

```typescript
async function createJwt(
  sub: string,
  email: string,
  role: string,
  emailVerified: boolean
): Promise<string> {
  const secret = new TextEncoder().encode(getEnv("JWT_SECRET"));
  return new SignJWT({ email, roles: [role], emailVerified, mustChangePassword: false })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)         // user UUID
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}
```

**JWT payload shape:**

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "roles": ["job_seeker"],
  "emailVerified": true,
  "mustChangePassword": false,
  "iat": 1700000000,
  "exp": 1700604800
}
```

**Verification (middleware):**

```typescript
import { jwtVerify } from "jose";

async function authMiddleware(c, next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);

  try {
    const token = authHeader.slice(7);
    const secret = new TextEncoder().encode(getEnv("JWT_SECRET"));
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    c.set("user", payload);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}
```

---

## Frontend Integration

### Why `/auth/callback` exists

The API issues the JWT and redirects the browser. But only browser JavaScript can write to `localStorage`. So the API redirects to a thin frontend page that does nothing except:

1. Read `?token=` from the URL
2. Call `loginWithToken(token)` to store it
3. Navigate to the redirect path

```typescript
// pages/OAuthCallback.tsx
export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");
    const redirect = searchParams.get("redirect") || "/dashboard";
    const errorParam = searchParams.get("error");

    if (errorParam) {
      // map error codes to human messages, then navigate to /login
      return;
    }

    loginWithToken(token)
      .then(() => navigate(redirect));
  }, []);

  return <LoadingSpinner />;
}
```

### `loginWithToken` in AuthContext

```typescript
const loginWithToken = async (token: string) => {
  localStorage.setItem("auth_token", token);
  const profile = await apiClient.get("/api/auth/me");
  setUser(profile.data);
};
```

### Magic link verify page

```typescript
// pages/MagicLinkVerify.tsx
export default function MagicLinkVerify() {
  const [searchParams] = useSearchParams();
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    apiClient.get(`/api/auth/magic-link/verify?token=${token}`)
      .then(async res => {
        await loginWithToken(res.data.token);
        navigate(res.data.redirect || "/dashboard");
      })
      .catch(() => setStatus("error"));
  }, []);
}
```

### OAuth buttons (React)

```typescript
const API_BASE = import.meta.env.VITE_API_URL;   // e.g. https://api.example.com (no trailing /api)

function OAuthButton({ provider, redirect }: { provider: string; redirect: string }) {
  return (
    <button onClick={() => {
      window.location.href =
        `${API_BASE}/api/auth/oauth/${provider}?redirect=${encodeURIComponent(redirect)}`;
    }}>
      Sign in with {provider}
    </button>
  );
}
```

> **Common mistake:** `VITE_API_URL` is the base domain without `/api`. The `/api` prefix is part of every endpoint path — include it in the path, not the base.

### Routes to add

```typescript
// App.tsx / router
<Route path="/auth/callback"   element={<OAuthCallback />} />
<Route path="/auth/magic-link" element={<MagicLinkVerify />} />
```

---

## Account Management

### List linked providers + whether account has a password

```
GET /api/auth/linked-accounts   (requires JWT)

Response:
{
  "accounts": [
    { "provider": "google", "email": "user@gmail.com", "displayName": "..." }
  ],
  "hasPassword": false
}
```

### Unlink a provider

```
DELETE /api/auth/unlink/:provider   (requires JWT)

Safety check: refuse if it would remove the user's only sign-in method.
```

```typescript
app.delete("/unlink/:provider", async (c) => {
  const userId = c.var.user.sub;
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users)
    .where(eq(users.id, userId)).limit(1);
  const allLinked = await db.select().from(oauthAccounts)
    .where(eq(oauthAccounts.userId, userId));

  // Block if no password AND this is their last linked provider
  if (!user?.passwordHash && allLinked.length <= 1) {
    return c.json({ error: "Cannot disconnect your only sign-in method. Add a password first." }, 403);
  }

  await db.delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)));

  return c.json({ success: true });
});
```

### Set password for OAuth-only accounts

```
POST /api/auth/add-password   (requires JWT)
Body: { "password": "..." }
```

```typescript
app.post("/add-password", async (c) => {
  const userId = c.var.user.sub;
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users)
    .where(eq(users.id, userId)).limit(1);

  if (user?.passwordHash) return c.json({ error: "Account already has a password" }, 409);

  const hash = await hashPassword(body.password);
  await db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId));

  return c.json({ success: true });
});
```

---

## Security Checklist

| Concern | Implementation |
|---------|---------------|
| State forgery (CSRF) | HMAC-SHA256 signed state, 10-min expiry, base64-encoded |
| Email enumeration | All "not found" paths return identical 200 responses |
| OAuth-only login via password | `verifyPassword` returns `false` for `null` hash — same error message |
| Token reuse (magic links) | Marked `used = true` immediately on first verify |
| Stale magic links | Previous unused tokens invalidated when a new one is issued |
| Last auth method | Block unlink if it would leave the account with no login method |
| Account takeover via email match | Email-matched linking is intentional — if someone controls the email, they can link |
| Suspended/inactive accounts | Checked on every OAuth callback and magic link verify |
| JWT secret strength | Minimum 32 random bytes; never commit to source control |
| Token storage | `localStorage` — acceptable if no XSS vectors; use HttpOnly cookies if you can |

---

## Environment Variables

```ini
# Core
JWT_SECRET=<min 32 random chars>
API_URL=https://api.example.com          # used to build OAuth callback URLs
FRONTEND_URL=https://example.com         # first value used for redirects

# Google
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# LinkedIn
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...

# GitHub
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# Microsoft
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
```

For Cloudflare Workers, set secrets via:

```bash
wrangler secret put JWT_SECRET
wrangler secret put API_URL
wrangler secret put GOOGLE_CLIENT_ID
# ... etc
```

For local dev, put them in `api/.dev.vars` (Wrangler loads this automatically).

---

## Provider Setup

### Google

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application)
2. Authorized redirect URIs: `https://api.example.com/api/auth/oauth/google/callback`
3. OAuth consent screen: External, scopes: `email profile openid`, add test users while in test mode
4. Copy Client ID + Client Secret

### LinkedIn

1. [LinkedIn Developer Portal](https://developer.linkedin.com/) → Create app
2. Auth tab → Redirect URLs: `https://api.example.com/api/auth/oauth/linkedin/callback`
3. **Products tab → request "Sign In with LinkedIn using OpenID Connect"** — required for `email` scope
4. Copy Client ID + Client Secret

### GitHub

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Authorization callback URL: `https://api.example.com/api/auth/oauth/github/callback`
3. Note: GitHub allows only **one** callback URL per app — create a separate dev app for local testing

### Microsoft

1. [Azure Portal](https://portal.azure.com/) → Microsoft Entra ID → App registrations → New registration
2. Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
3. Redirect URI (Web): `https://api.example.com/api/auth/oauth/microsoft/callback`
4. Certificates & secrets → New client secret (copy value immediately)
5. Copy Application (client) ID from Overview

### Callback URL pattern

```
https://{API_HOST}/api/auth/oauth/{provider}/callback
```

Register this exact URL in each provider's dashboard. The `{provider}` segment is lowercase: `google`, `linkedin`, `github`, `microsoft`.
