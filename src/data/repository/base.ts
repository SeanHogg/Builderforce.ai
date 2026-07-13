/**
 * Base Repository Pattern for Tax Compliance Data Access
 * 
 * Common interface for tax form repositories with typed access.
 */

/**
 * Generic repository interface with CRUD operations
 */
export interface IRepository<T, TId> {
  /**
   * Find item by primary key
   */
  findById(id: TId): Promise<T | null>;

  /**
   * Find by freelancer ID (highest priority for tax retrieval)
   */
  findByFreelancerId(freelancerId: string): Promise<T | null>;

  /**
   * List all items with optional filters
   */
  list(options?: {
    status?: TaxFormStatus;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<Array<{ item: T; total: number }>>;

  /**
   * Create new item
   */
  create(item: T): Promise<T>;

  /**
   * Update existing item
   */
  update(id: TId, updates: Partial<T>): Promise<T>;

  /**
   * Delete item
   */
  delete(id: TId): Promise<boolean>;

  /**
   * Soft delete / archive
   */
  archive(id: TId, reason?: string): Promise<boolean>;

  /**
   * Check if TIN exists and is linked to freelancer
   * (for duplicate detection)
   */
  tinsLinkedToFreelancer(tin: string, excludeId?: string): Promise<boolean>;

  /**
   * Search form entity by form type, fiscal year, category (for 1099s)
   */
  findFormByTypeAndYear(
    formType: 'w9' | 'w8ben',
    fiscalYear: number,
    category: string | null
  ): Promise<W9Entity | null | void>;

  /**
   * Find PDF document URL by form ID
   */
  findDocumentUrl(formId: string, documentKey: string): Promise<string | null>;
}

/**
 * Common result wrapper
 */
export interface Result<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}