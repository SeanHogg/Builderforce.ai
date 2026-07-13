/**
 * Capability service - business logic for capabilities.
 */

import type {
  CreateCapabilityDTO,
  UpdateCapabilityDTO,
  CapabilityListParams,
} from '../../domain/capability/ICapabilityRepository';

export class CapabilityService {
  constructor(private readonly repo: any) {} // TODO: type correctly

  async create(dto: CreateCapabilityDTO) {
    const capability = await this.repo.create(dto);
    return capability;
  }

  async getById(id: string) {
    return this.repo.getById(id);
  }

  async update(id: string, dto: UpdateCapabilityDTO) {
    return this.repo.update(id, dto);
  }

  async delete(id: string) {
    return this.repo.delete(id);
  }

  async list(params: CapabilityListParams) {
    return this.repo.list(params);
  }

  async count(tenantId: string) {
    return this.repo.count(tenantId);
  }
}