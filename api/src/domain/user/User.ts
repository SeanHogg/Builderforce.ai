import { UserId } from '../shared/types';
import { ValidationError } from '../shared/errors';

export interface UserProps {
  id:            UserId;
  email:         string;
  apiKeyHash:    string | null;
  // Web / marketplace profile (nullable – only set for web registrations)
  username:      string | null;
  displayName:   string | null;
  avatarUrl:     string | null;
  bio:           string | null;
  passwordHash:  string | null;
  isSuperadmin:  boolean;
  createdAt:     Date;
  updatedAt:     Date;
}

/**
 * User aggregate root.
 *
 * Supports two registration paths:
 *  • API key path: `User.create()` – generates an API key hash, no password.
 *  • Web path: `User.createWeb()` – email + username + password hash, generates a
 *    placeholder API key hash the user never sees.
 */
export class User {
  private constructor(private readonly props: UserProps) {}

  /** Create a new API-key user (SDK / CLI path). */
  static create(email: string, apiKeyHash: string): User {
    const e = email.toLowerCase().trim();
    if (!e.includes('@')) throw new ValidationError('Invalid email address');
    const now = new Date();
    return new User({
      id: crypto.randomUUID() as UserId,
      email: e,
      apiKeyHash,
      username: null,
      displayName: null,
      avatarUrl: null,
      bio: null,
      passwordHash: null,
      isSuperadmin: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Create a new web / marketplace user (email + username + password). */
  static createWeb(
    email:        string,
    username:     string,
    passwordHash: string,
    apiKeyHash:   string,   // placeholder – web users get a key but it's not shown
  ): User {
    const e = email.toLowerCase().trim();
    if (!e.includes('@')) throw new ValidationError('Invalid email address');
    if (!username.trim())  throw new ValidationError('Username is required');
    const now = new Date();
    return new User({
      id: crypto.randomUUID() as UserId,
      email: e,
      apiKeyHash,
      username: username.toLowerCase().trim(),
      displayName: null,
      avatarUrl: null,
      bio: null,
      passwordHash,
      isSuperadmin: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: UserProps): User {
    return new User(props);
  }

  get id(): UserId                  { return this.props.id; }
  get email(): string               { return this.props.email; }
  get apiKeyHash(): string | null   { return this.props.apiKeyHash; }
  get username(): string | null     { return this.props.username; }
  get displayName(): string | null  { return this.props.displayName; }
  get avatarUrl(): string | null    { return this.props.avatarUrl; }
  get bio(): string | null          { return this.props.bio; }
  get passwordHash(): string | null { return this.props.passwordHash; }
  get isSuperadmin(): boolean       { return this.props.isSuperadmin; }
  get createdAt(): Date             { return this.props.createdAt; }
  get updatedAt(): Date             { return this.props.updatedAt; }

  toPlain(): UserProps { return { ...this.props }; }
}
