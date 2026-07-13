import type { AiCapability, ModelInfo, ModelsListResponse } from '../domain/types';
import { HttpClient } from '../infrastructure/httpClient';

export class ModelsApi {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /** Raw `/llm/v1/models` response — pool status, capabilities, plan, cooldowns. */
  list(): Promise<ModelsListResponse> {
    return this.http.getJson<ModelsListResponse>('/llm/v1/models');
  }

  /**
   * Models in the tenant's plan pool, as structured entries. Empty when the
   * gateway is unconfigured for this tenant (no `data` branch — nothing servable).
   */
  async listInfo(): Promise<ModelInfo[]> {
    const res = await this.list();
    return res.data ?? [];
  }

  /**
   * Models whose `capabilities` include `capability`. By default only
   * currently-servable models are returned (`available: true`); pass
   * `{ includeUnavailable: true }` to include cooled / key-unbound ones too.
   */
  async listByCapability(
    capability: AiCapability,
    opts?: { includeUnavailable?: boolean },
  ): Promise<ModelInfo[]> {
    const includeUnavailable = opts?.includeUnavailable ?? false;
    const all = await this.listInfo();
    return all.filter(
      (m) =>
        (m.capabilities?.includes(capability) ?? false) &&
        (includeUnavailable || m.available),
    );
  }

  /**
   * Models that can read images and (page-rasterized) PDFs — i.e. those with the
   * `vision` OR `ocr` capability. This is the set a consumer that needs to ingest
   * images / documents (e.g. hired.video) should pick from.
   */
  async listImageCapable(opts?: { includeUnavailable?: boolean }): Promise<ModelInfo[]> {
    const includeUnavailable = opts?.includeUnavailable ?? false;
    const all = await this.listInfo();
    return all.filter(
      (m) =>
        ((m.capabilities?.includes('vision') ?? false) ||
          (m.capabilities?.includes('ocr') ?? false)) &&
        (includeUnavailable || m.available),
    );
  }

  /** Models tuned for text extraction from images / documents (`ocr` capability). */
  listOcr(opts?: { includeUnavailable?: boolean }): Promise<ModelInfo[]> {
    return this.listByCapability('ocr', opts);
  }

  /** Models that accept image content blocks (`vision` capability). */
  listVision(opts?: { includeUnavailable?: boolean }): Promise<ModelInfo[]> {
    return this.listByCapability('vision', opts);
  }
}
