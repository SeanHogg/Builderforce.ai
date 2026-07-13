/**
 * W-8BEN Tax Form Repository
 * 
 * Data access layer for W-8BEN forms (foreign-person tax forms) using SQL database.
 */

import { W8BENEntity, IRepository, TaxFormStatus, TaxEntityType, ForeignTaxAddress } from './base';

/**
 * PostgreSQL schema for W-8BEN forms
 * 
 * CREATE TABLE w8ben_forms (
 *   id TEXT PRIMARY KEY,
 *   freelancer_id TEXT NOT NULL,
 *   version INTEGER NOT NULL,
 *   submitted_at TIMESTAMPTZ NOT NULL,
 *   valid_from TIMESTAMPTZ NOT NULL,
 *   effective_until TIMESTAMPTZ,
 *   status TEXT NOT NULL,
 *   taxpayer_type TEXT NOT NULL,
 *   entity_name TEXT,
 *   foreign_tax_number TEXT,
 *   foreign_address JSONB NOT NULL,
 *   beneficial_owner JSONB,
 *   waiver_text BOOLEAN,
 *   archive_reason TEXT,
 *   archived_at TIMESTAMPTZ,
 *   form_type TEXT NOT NULL,
 *   form_data_json JSONB NOT NULL,
 *   scanned_document_url TEXT,
 *   uploaded_at TIMESTAMPTZ NOT NULL,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW(),
 * 
 *   CONSTRAINT fk_freelancer FOREIGN KEY (freelancer_id) REFERENCES freelancer_profiles(id)
 * );
 * 
 * Indexes:
 *   CREATE INDEX idx_w8ben_status ON w8ben_forms(status);
 *   CREATE INDEX idx_w8ben_freelancer ON w8ben_forms(freelancer_id);
 *   CREATE INDEX idx_w8ben_valid_from ON w8ben_forms(valid_from);
 */

export class W8BENRepository implements IRepository<W8BENEntity, string> {
  constructor(private dbUrl: string) {}

  async _query(sql: string, params: any[] = []): Promise<any[]> {
    // Implement actual database connection here
    // This is a placeholder for the actual SQL implementation
    console.log('SQL Query:', sql);
    console.log('Params:', params);
    return [];
  }

  async _getOne(sql: string, params: any[]): Promise<W8BENEntity | null> {
    const results = await this._query(sql, params);
    return results.length > 0 ? this._rowToEntity(results[0]) : null;
  }

  async findById(id: string): Promise<W8BENEntity | null> {
    return this._getOne('SELECT * FROM w8ben_forms WHERE id = $1', [id]);
  }

  async findByFreelancerId(freelancerId: string): Promise<W8BENEntity | null> {
    const sql = `
      SELECT * FROM w8ben_forms 
      WHERE freelancer_id = $1 
      AND (status = 'verified' OR status = 'submitted')
      ORDER BY version DESC 
      LIMIT 1
    `;
    return this._getOne(sql, [freelancerId]);
  }

  async findVersionsByFreelancerId(freelancerId: string): Promise<W8BENEntity[]> {
    const sql = `
      SELECT * FROM w8ben_forms 
      WHERE freelancer_id = $1 
      ORDER BY version DESC, valid_from DESC
    `;
    const results = await this._query(sql, [freelancerId]);
    return results.map(row => this._rowToEntity(row));
  }

  async findLatestVerifiedByFreelancerId(freelancerId: string): Promise<W8BENEntity | null> {
    const sql = `
      SELECT * FROM w8ben_forms
      WHERE freelancer_id = $1
      AND status = 'verified'
      ORDER BY valid_from DESC
      LIMIT 1
    `;
    return this._getOne(sql, [freelancerId]);
  }

  async findFormByTypeAndYear(
    formType: 'w8ben',
    fiscalYear: number,
    category: string | null
  ): Promise<W8BENEntity | null | void> {
    // W-8BEN is not subject to interest in 1099 generation (foreign person)
    // This method exists for API compatibility but returns null
    return null;
  }

  async findDocumentUrl(formId: string, documentKey: string): Promise<string | null> {
    const sql = `
      SELECT ${documentKey} FROM w8ben_forms 
      WHERE id = $1
    `;
    const result = await this._getOne(sql, [formId]);
    return result ? (result as any)[documentKey] || null : null;
  }

  async list(options?: {
    status?: TaxFormStatus;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<Array<{ item: W8BENEntity; total: number }>> {
    const builder = new W8BENQueryBuilder();

    if (options?.status) {
      builder.where('status', '=', options.status);
    }

    if (options?.sortBy) {
      builder.orderBy(options.sortBy, options.sortOrder || 'asc');
    }

    if (options?.limit) {
      builder.limit(options.limit);
    }

    if (options?.offset) {
      builder.offset(options.offset);
    }

    const countSql = `SELECT COUNT(*) as total FROM w8ben_forms ${builder.build().sql}`;
    const countResult = await this._query(countSql, builder.build().params);
    const total = countResult[0]?.total || 0;

    const sql = builder.build().sql;
    const results = await this._query(sql, builder.build().params);

    return {
      items: results.map(row => this._rowToEntity(row)),
      total,
    };
  }

  async create(item: W8BENEntity): Promise<W8BENEntity> {
    const sql = `
      INSERT INTO w8ben_forms (
        id, freelancer_id, version, submitted_at, valid_from,
        status, taxpayer_type, entity_name,
        foreign_tax_number, foreign_address,
        beneficial_owner, waiver_text,
        form_type, form_data_json, scanned_document_url, uploaded_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10,
        $11, $12,
        $13, $14, $15, $16
      )
      RETURNING *
    `;

    const result = await this._query(sql, [
      item.id,
      item.freelancerId,
      item.version,
      item.submittedAt,
      item.validFrom,
      item.status,
      item.taxpayerType,
      item.entityName,
      item.foreignTaxNumber,
      JSON.stringify(item.foreignAddress),
      item.beneficialOwner ? JSON.stringify(item.beneficialOwner) : null,
      item.waiverText || false,
      item.formType,
      JSON.stringify(item.formDataJson),
      item.scannedDocumentUrl,
      item.uploadedAt,
    ]);

    return this._rowToEntity(result[0]);
  }

  async update(id: string, updates: Partial<W8BENEntity>): Promise<W8BENEntity> {
    const updatesList: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    const immutableFields = ['freelancerId', 'version', 'submittedAt'];

    if (!updates.id) updates.id = id;

    for (const [key, value] of Object.entries(updates)) {
      if (immutableFields.includes(key)) continue;
      
      if (value !== undefined) {
        updatesList.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (updatesList.length === 0) {
      const current = await this.findById(id);
      if (!current) {
        throw new Error(`W-8BEN form ${id} not found`);
      }
      return current;
    }

    updatesList.push('updated_at = NOW()');
    params.push(id);
    paramIndex++;

    const sql = `
      UPDATE w8ben_forms 
      SET ${updatesList.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this._query(sql, params);
    return this._rowToEntity(result[0]);
  }

  async delete(id: string): Promise<boolean> {
    const sql = 'DELETE FROM w8ben_forms WHERE id = $1 RETURNING id';
    const result = await this._query(sql, [id]);
    return result.length > 0;
  }

  async archive(id: string, reason?: string): Promise<boolean> {
    const sql = `
      UPDATE w8ben_forms 
      SET status = 'archived', archived_at = NOW()
      WHERE id = $1 AND archive_reason = $2
      RETURNING id
    `;
    const result = await this._query(sql, [id, reason]);
    return result.length > 0;
  }

  async tinsLinkedToFreelancer(tin: string, excludeId?: string): Promise<boolean> {
    // W-8BEN foreign tax numbers are different from US TINs
    // This is primarily used for W-9 checks (duplicate US TINs)
    return false;
  }

  async findExpiredForms(daysSinceExpiry: number): Promise<W8BENEntity[]> {
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() - daysSinceExpiry);

    const sql = `
      SELECT * FROM w8ben_forms 
      WHERE effective_until IS NOT NULL 
      AND effective_until < $1
      ORDER BY effective_until DESC
    `;

    const results = await this._query(sql, [expiryThreshold.toISOString()]);
    return results.map(row => this._rowToEntity(row));
  }

  private _rowToEntity(row: any): W8BENEntity {
    return {
      id: row.id,
      freelancerId: row.freelancerId,
      version: row.version,
      submittedAt: row.submittedAt,
      validFrom: row.validFrom,
      effectiveUntil: row.effectiveUntil ? new Date(row.effectiveUntil) : undefined,
      status: row.status as TaxFormStatus,
      taxpayerType: row.taxpayerType as TaxEntityType,
      entityName: row.entity_name,
      foreignTaxNumber: row.foreign_tax_number,
      foreignAddress: row.foreign_address,
      beneficialOwner: row.beneficial_owner ? JSON.parse(row.beneficial_owner) : undefined,
      waiverText: row.waiver_text,
      archiveReason: row.archive_reason,
      archivedAt: row.archived_at ? new Date(row.archived_at) : undefined,
      formType: row.form_type,
      formDataJson: JSON.parse(row.form_data_json),
      scannedDocumentUrl: row.scanned_document_url,
      uploadedAt: row.uploadedAt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Query builder for W-8BEN
 */
class W8BENQueryBuilder {
  private filters: Map<string, string> = new Map();
  private orderBy: string[] = [];
  private limit?: number;
  private offset?: number;

  where(field: string, op: string, value: string): this {
    if (value) {
      this.filters.set(field, `${op} ${value}`);
    }
    return this;
  }

  orderBy(field: string, order: 'asc' | 'desc' = 'asc'): this {
    this.orderBy.push(`${field} ${order}`);
    return this;
  }

  limit(value: number): this {
    this.limit = value;
    return this;
  }

  offset(value: number): this {
    this.offset = value;
    return this;
  }

  build(): { sql: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

    this.filters.forEach((condition, value) => {
      const paramIndex = params.length + 1;
      conditions.push(condition.replace(/__param__/g, `$${paramIndex}`));
      params.push(value);
    });

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderClause = this.orderBy.length > 0 ? `ORDER BY ${this.orderBy.join(', ')}` : '';
    const limitClause = this.limit ? `LIMIT ${this.limit}` : '';
    const offsetClause = this.offset ? `OFFSET ${this.offset}` : '';

    return {
      sql: `SELECT * FROM w8ben_forms ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`,
      params,
    };
  }
}