/**
 * W-9 Tax Form Repository
 * 
 * Data access layer for W-9 forms using SQL database.
 */

import { W9Entity, IRepository, TaxFormStatus, TaxEntityType, TaxTINType } from '../base';

/**
 * SQL query builder utilities
 */
class QueryBuilder {
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
      // Postgres-style $1, $2
      const paramIndex = params.length + 1;
      conditions.push(condition.replace(/__param__/g, `$${paramIndex}`));
      params.push(value);
    });

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderClause = this.orderBy.length > 0 ? `ORDER BY ${this.orderBy.join(', ')}` : '';
    const limitClause = this.limit ? `LIMIT ${this.limit}` : '';
    const offsetClause = this.offset ? `OFFSET ${this.offset}` : '';

    return {
      sql: `SELECT * FROM w9_forms ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`,
      params,
    };
  }
}

/**
 * PostgreSQL schema for W-9 forms
 * 
 * CREATE TABLE w9_forms (
 *   id TEXT PRIMARY KEY,
 *   freelancer_id TEXT NOT NULL,
 *   version INTEGER NOT NULL,
 *   submitted_at TIMESTAMPTZ NOT NULL,
 *   valid_from TIMESTAMPTZ NOT NULL,
 *   effective_until TIMESTAMPTZ,
 *   status TEXT NOT NULL,
 *   taxpayer_type TEXT NOT NULL,
 *   tin_type TEXT NOT NULL,
 *   tin TEXT NOT NULL,
 *   name_on_form TEXT NOT NULL,
 *   business_name TEXT,
 *   address JSONB NOT NULL,
 *   account_numbers TEXT,
 *   statement_transactions INTEGER,
 *   waiver_checkbox INTEGER,
 *   reset_ein INTEGER,
 *   form_data_json JSONB NOT NULL,
 *   scanned_document_url TEXT,
 *   uploaded_at TIMESTAMPTZ NOT NULL,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW(),
 *   
 *   CONSTRAINT fk_freelancer FOREIGN KEY (freelancer_id) REFERENCES freelancer_profiles(id),
 *   CONSTRAINT uidx_freelancer_tin UNIQUE (freelancer_id, tin, effective_until IS NULL)
 * );
 * 
 * Indexes:
 *   CREATE INDEX idx_w9_status ON w9_forms(status);
 *   CREATE INDEX idx_w9_freelancer ON w9_forms(freelancer_id);
 *   CREATE INDEX idx_w9_tin ON w9_forms(tin);
 *   CREATE INDEX idx_w9_valid_from ON w9_forms(valid_from);
 */

export class W9Repository implements IRepository<W9Entity, string> {
  constructor(private dbUrl: string) {}

  async _query(sql: string, params: any[] = []): Promise<any[]> {
    // Implement actual database connection here
    // This is a placeholder for the actual SQL implementation
    console.log('SQL Query:', sql);
    console.log('Params:', params);
    return [];
  }

  async _getOne(sql: string, params: any[]): Promise<W9Entity | null> {
    const results = await this._query(sql, params);
    return results.length > 0 ? this._rowToEntity(results[0]) : null;
  }

  /**
   * Find by ID
   */
  async findById(id: string): Promise<W9Entity | null> {
    return this._getOne('SELECT * FROM w9_forms WHERE id = $1', [id]);
  }

  /**
   * Find most recent form by freelancer ID (active or latest)
   */
  async findByFreelancerId(freelancerId: string): Promise<W9Entity | null> {
    // Find active form or latest version (both not expired)
    const sql = `
      SELECT * FROM w9_forms 
      WHERE freelancer_id = $1 
      AND (status = 'verified' OR status = 'submitted')
      ORDER BY version DESC 
      LIMIT 1
    `;
    return this._getOne(sql, [freelancerId]);
  }

  /**
   * Find all versions of a freelancer's W-9 forms
   */
  async findVersionsByFreelancerId(freelancerId: string): Promise<W9Entity[]> {
    const sql = `
      SELECT * FROM w9_forms 
      WHERE freelancer_id = $1 
      ORDER BY version DESC, valid_from DESC
    `;
    const results = await this._query(sql, [freelancerId]);
    return results.map(row => this._rowToEntity(row));
  }

  /**
   * List W-9 forms with filters
   */
  async list(options?: {
    status?: TaxFormStatus;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<Array<{ item: W9Entity; total: number }>> {
    const builder = new QueryBuilder();

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

    // Get count
    const countSql = `SELECT COUNT(*) as total FROM w9_forms ${builder.build().sql.replace(/\*$/, '')}`;
    const countResult = await this._query(countSql, builder.build().params);
    const total = countResult[0]?.total || 0;

    // Get items
    const sql = builder.build().sql;
    const results = await this._query(sql, builder.build().params);

    return {
      items: results.map(row => this._rowToEntity(row)),
      total,
    };
  }

  /**
   * Find expired forms for cleanup
   */
  async findExpiredForms(daysSinceExpiry: number): Promise<W9Entity[]> {
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() - daysSinceExpiry);

    const sql = `
      SELECT * FROM w9_forms 
      WHERE effective_until IS NOT NULL 
      AND effective_until < $1
      ORDER BY effective_until DESC
    `;

    const results = await this._query(sql, [expiryThreshold.toISOString()]);
    return results.map(row => this._rowToEntity(row));
  }

  /**
   * TIN already linked to this freelancer (maybe matching earlier form)?
   * ExcludeId prevents reporting "Myself" when we are querying against myself.
   */
  async tinsLinkedToFreelancer(tin: string, excludeId?: string): Promise<boolean> {
    // CAS checks: fetched row is not self (excludeId)
    const sql = `
      SELECT EXISTS(
        SELECT 1 FROM w9_forms 
        WHERE freelancer_id != $2  -- Exclude self (or unfactored纪检)
           AND tin = $1 
           AND effective_until IS NULL  -- Active records only (neither myself nor earlier versions)
      )
    `;

    const result = await this._getOne(sql, [tin, excludeId]);
    return (result as { exists: boolean })?.exists || false;
  }

  /**
   * Create new W-9 form
   */
  async create(item: W9Entity): Promise<W9Entity> {
    const sql = `
      INSERT INTO w9_forms (
        id, freelancer_id, version, submitted_at, valid_from,
        status, taxpayer_type, tin_type, tin, name_on_form,
        business_name, address, account_numbers, statement_transactions,
        waiver_checkbox, reset_ein, form_data_json, scanned_document_url,
        uploaded_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19
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
      item.tinType,
      item.tin,
      item.nameOnForm,
      item.businessName,
      item.address,
      item.accountNumbers,
      item.statementTransactions,
      item.waiverCheckbox,
      item.resetEIN,
      JSON.stringify(item.formDataJson),
      item.scannedDocumentUrl,
      item.uploadedAt,
    ]);

    return this._rowToEntity(result[0]);
  }

  /**
   * Update existing W-9 form
   */
  async update(id: string, updates: Partial<W9Entity>): Promise<W9Entity> {
    const updatesList: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Don't allow direct updates on immutable fields
    const immutableFields = [
      'freelancerId',
      'version',
      'submittedAt',
    ];

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
        throw new Error(`W-9 form ${id} not found`);
      }
      return current;
    }

    updatesList.push('updated_at = NOW()');
    params.push(id);
    paramIndex++;

    const sql = `
      UPDATE w9_forms 
      SET ${updatesList.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this._query(sql, params);
    return this._rowToEntity(result[0]);
  }

  /**
   * Delete W-9 form
   */
  async delete(id: string): Promise<boolean> {
    const sql = 'DELETE FROM w9_forms WHERE id = $1 RETURNING id';
    const result = await this._query(sql, [id]);
    return result.length > 0;
  }

  /**
   * Archive W-9 form
   */
  async archive(id: string, reason?: string): Promise<boolean> {
    const sql = `
      UPDATE w9_forms 
      SET status = 'archived', archived_at = NOW()
      WHERE id = $1 AND reason = $2
      RETURNING id
    `;

    const result = await this._query(sql, [id, reason]);
    return result.length > 0;
  }

  /**
   * Find latest verified form by freelancer ID
   */
  async findLatestVerifiedByFreelancerId(freelancerId: string): Promise<W9Entity | null> {
    const sql = `
      SELECT * FROM w9_forms
      WHERE freelancer_id = $1
      AND status = 'verified'
      ORDER BY valid_from DESC
      LIMIT 1
    `;
    return this._getOne(sql, [freelancerId]);
  }

  /**
   * Find form retained for IRS deadline (versioned)
   */
  async findFormByTypeAndYear(
    formType: 'w9',
    fiscalYear: number,
    category: string | null
  ): Promise<W9Entity | null | void> {
    const sql = `
      SELECT * FROM w9_forms
      WHERE id IN (
        SELECT id FROM w9_form_versions
        WHERE fiscal_year = $1
          AND category = $2
      )
      ORDER BY version DESC
      LIMIT 1
    `;

    const result = await this._getOne(sql, [fiscalYear, category]);
    return result || null;
  }

  /**
   * Find PDF document URL
   */
  async findDocumentUrl(formId: string, documentKey: string): Promise<string | null> {
    const sql = `
      SELECT ${documentKey} FROM w9_forms 
      WHERE id = $1
    `;
    const result = await this._getOne(sql, [formId]);
    return result ? (result as any)[documentKey] || null : null;
  }

  /**
   * Export to CSV for 1099 generation
   */
  async exportToCSV(freelancerId: string, startDate: Date, endDate: Date): Promise<string> {
    const sql = `
      SELECT * FROM payment_records
      WHERE freelancer_id = $1
        AND payment_date BETWEEN $2 AND $3
        AND amount >= 600
      ORDER BY payment_date
    `;

    const results = await this._query(sql, [freelancerId, startDate.toISOString(), endDate.toISOString()]);

    const lines = [];
    lines.push([
      'Taxpayer TIN',
      'Taxpayer Name',
      'Street Address',
      'City',
      'State',
      'Zip Code',
      'Country',
      'Account Number',
      'Federal Tax Classification',
      'Federal Tax ID Number',
      '1. Payer made direct payments of $600 or more to you for services (miscellaneous income)',
      '2. Payments reportable on Form 1099-NEC',
    ].join(','));

    for (const row of results) {
      const form = await this.findById(row.freelancerId);
      if (form) {
        lines.push([
          form.tin,
          form.nameOnForm,
          form.address.street_line1,
          form.address.city,
          form.address.state,
          form.address.postal_code,
          form.address.country,
          form.accountNumbers || '',
          this.getFederalTaxClassification(form.taxpayerType),
          '', // Form 947 (no line)
          '', // Compliant with Form 1099-NEC reporting threshold
          row.amount >= 1000 ? 'YES' : 'NO',
        ].join(','));
      }
    }

    return lines.join('\n');
  }

  private _rowToEntity(row: any): W9Entity {
    return {
      id: row.id,
      freelancerId: row.freelancer_id,
      version: row.version,
      submittedAt: row.submitted_at,
      validFrom: row.valid_from,
      effectiveUntil: row.effective_until ? new Date(row.effective_until) : undefined,
      status: row.status as TaxFormStatus,
      taxpayerType: row.taxpayer_type as TaxEntityType,
      tinType: row.tin_type as TaxTINType,
      tin: row.tin,
      nameOnForm: row.name_on_form,
      businessName: row.business_name,
      address: row.address,
      accountNumbers: row.account_numbers,
      statementTransactions: row.statement_transactions,
      waiverCheckbox: row.waiver_checkbox,
      resetEIN: row.reset_ein,
      formDataJson: JSON.parse(row.form_data_json),
      scannedDocumentUrl: row.scanned_document_url,
      uploadedAt: row.uploaded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getFederalTaxClassification(entityType: TaxEntityType): string {
    switch (entityType) {
      case TaxEntityType.INDIVIDUAL:
        return 'Independent Contractor -- Other than services';
      case TaxEntityType.CORPORATION:
        return 'Corporation';
      case TaxEntityType.LLC:
        return 'Limited Liability Company (LLC)';
      case TaxEntityType.PARTNERSHIP:
        return 'Partnership';
      case TaxEntityType.TRUST:
        return 'Trust/ Estate';
      default:
        return 'Other';
    }
  }
}