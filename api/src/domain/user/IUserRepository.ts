import { User, UserProps } from './User';
import { UserId } from '../shared/types';

export interface IUserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByApiKeyHash(hash: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  save(user: User): Promise<User>;
  updateProfile(userId: UserId, updates: Partial<Pick<UserProps, 'displayName' | 'avatarUrl' | 'bio' | 'username'>>): Promise<User>;
}
