/**
 * Tax Compliance Service
 * 
 * Core business logic for W-9/W-8BEN form collection, storage, and 1099 generation.
 */

import { W9Repository, W8BENRepository } from '../../data/repository';
import { TaxFormValidationService } from './validation_service';
import { 
  IRS_THRESHOLD, 
  TaxCategories, 
  getIrCategory, 
  AllowedTaxForms 
} from './record_keys';
import { 
  W9Form, 
  W8BENForm, 
  Generated1099,
  TaxFormSubmissionResponse,
  TaxValidationError,
  TaxAddressForExport,
  PaymentRecordExport,
  EFileStatus, 
  calculateEfilingDeadlines 
} from '../../data/types';
import { PaymentEntity } from '../../models/tax';

/**
 * 1099 Generation Service
 */
export class Tax1099Service {
  constructor(
    private w9Repo: W9Repository,
    private w8benRepo: W8BENRepository
  ) {}

  /**
   * Generate all 1099 forms for a given fiscal year
   */
  async generateAll1099s(fiscalYear: number): Promise<{
    generated: Generated1099[];
    errors: Array<{ freelancerId: string; error: string }>;
  }> {
    const errors: Array<{ freelancerId: string; error: string }> = [];
    const generated: Generated1099[] = [];

    // Get all freelancers with US W-9 forms
    const usPayeesWithW9 = await this._findUSPayeesWithW9(fiscalYear);
    
    for (const payee of usPayeesWithW9) {
      try {
        // Find 1099-NEC or MISC form type based on category
        const formType = payee.irsTargetCategory === 'nec' ? '1099-NEC' : '1099-MISC';
        
        const generatedForm = await this._generate1099ForPayee(
          fiscalYear,
          formType,
          payee
        );
        
        if (generatedForm) {
          generated.push(generatedForm);
        }
      } catch (error: any) {
        errors.push({
          freelancerId: payee.freelancerId,
          error: error.message || 'Failed to generate 1099'
        });
      }
    }

    return { generated, errors };
  }

  /**
   * Generate a single 1099 form for a specific payee
   */
  async generate1099ForPayee(
    fiscalYear: number,
    formType: '1099-NEC' | '1099-MISC',
    recipientId: string
  ): Promise<Generated1099 | null> {
    // Verify payee has valid W-9 form
    const w9Form = await this.w9Repo.findLatestVerifiedByFreelancerId(recipientId);
    if (!w9Form) {
      throw new Error('No verified W-9 form found for this payee');
    }

    // Aggregate payments for this payee
    const payments = await this._aggregatePayments(fiscalYear, recipientId, formType);

    // Check IRS threshold (exceed $600)
    if (payments.totalAmount < IRS_THRESHOLD * 100) {
      // No need to generate 1099 for this payee
      return null;
    }

    // Create the 1099 entity
    const entity: Generated1099 = {
      id: this._generateFormId(fiscalYear, recipientId, formType),
      fiscalYear,
      formType,
      status: 'draft',
      recipientId,
      totalPayments: {
        count: payments.count,
        totalAmount: payments.totalAmount,
        grossAmount: payments.totalAmount,
        netAmount: this._calculateNetAmount(payments.totalAmount),
      },
      payments: payments.records,
      generatedAt: new Date(),
      lastModifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return entity;
  }

  /**
   * Prepare 1099 for e-filing with a third-party provider
   */
  async prepareForEfiling(formId: string, provider: string): Promise<Generated1099> {
    const form = await this._retrieveFormById(formId);
    if (!form) {
      throw new Error('Form not found');
    }

    if (form.status !== 'ready') {
      throw new Error('Form must be in ready state before e-filing');
    }

    const status: EFileStatus = {
      provider,
      status: 'filing',
    };

    return {
      ...form,
      eFiling: status,
      updatedAt: new Date(),
    };
  }

  /**
   * Check e-filing requirements for a form
   */
  async checkEfilingRequirements(
    formId: string, 
    fiscalYear: number, 
    currentDate: Date
  ): Promise<{
    ready: boolean;
    missing: string[];
    efileMessage: string;
  }> {
    const form = await this._retrieveFormById(formId);
    if (!form) {
      throw new Error('Form not found');
    }

    const missing: string[] = [];

    // Check if form is ready
    if (form.status !== 'ready') {
      missing.push('form_status');
    }

    // Check if recipient has required information
    if (!form.recipientDetails?.tin) {
      missing.push('recipient_tin');
    }

    if (!form.recipientDetails?.address) {
      missing.push('recipient_address');
    }

    // Check if CMS-1500 (optically scannable 1099) is available
    if (!form.documents?.pdfUrl) {
      missing.push('scannable_form');
    }

    // Check deadline compliance
    const { compliant, deadlinePassed, daysUntilDeadline } = TaxFormValidationService.validateEfilingDeadline(
      fiscalYear,
      currentDate
    );

    if (!compliant && !deadlinePassed) {
      if (daysUntilDeadline > 0) {
        missing.push('deadline_upcoming');
      } else {
        missing.push('deadline_passed');
      }
    }

    const ready = missing.length === 0;
    const efileMessage = ready 
      ? 'Form is ready for e-filing'
      : `Missing requirements: ${missing.join(', ')}`;

    return { ready, missing, efileMessage };
  }

  /**
   * Export form data in third-party-compatible format (e.g., Justworks, Parade)
   */
  async exportForThirdParty(formId: string, provider: string): Promise<Tax1099Export> {
    const form = await this._retrieveFormById(formId);
    if (!form) {
      throw new Error('Form not found');
    }

    const w9Form = await this.w9Repo.findById(form.recipientId);
    if (!w9Form) {
      throw new Error('W-9 form not found');
    }

    const payments = await this._aggregatePayments(
      form.fiscalYear,
      w9Form.freelancerId,
      form.formType === '1099-NEC' ? 'nec' : 'misc'
    );

    const exportData: Tax1099Export = {
      recipientTin: w9Form.tin,
      recipientName: w9Form.nameOnForm,
      recipientAddress: {
        streetLine1: w9Form.address.street_line1,
        streetLine2: w9Form.address.street_line2,
        city: w9Form.address.city,
        state: w9Form.address.state,
        postalCode: w9Form.address.postal_code,
        country: w9Form.address.country,
      },
      totalAmount: payments.totalAmount,
      paymentCount: payments.count,
      payments: payments.records.map(p => ({
        invoiceId: p.invoiceId,
        amount: p.amount,
        currency: p.currency,
        paymentDate: p.paymentDate,
        category: p.category,
      })),
      irsTargetCategory: form.formType === '1099-NEC' ? 'nec' : null,
      exportDate: new Date(),
      exportBatchId: this._generateExportBatchId(),
    };

    return exportData;
  }

  /* Private Helper Methods */

  private async _findUSPayeesWithW9(fiscalYear: number) {
    // In a real implementation, this would:
    // 1. Query payments table for NEC/MISC records in the fiscal year
    // 2. Join with tax_forms to find US payees (country_of_gross_payments = 'US')
    // 3. Return list of payees with their latest W-9 and IRS-specific metadata
    
    // Placeholder: return empty array
    return [];
  }

  private async _aggregatePayments(
    fiscalYear: number,
    freelancerId: string,
    category: 'nec' | 'misc'
  ): Promise<{
    count: number;
    totalAmount: number;
    records: PaymentEntity[];
  }> {
    // In a real implementation, query payments table
    // Filter by freelancerId, fiscal year, and category
    
    return {
      count: 0,
      totalAmount: 0,
      records: [],
    };
  }

  private async _generateFormId(fiscalYear: number, recipientId: string, formType: string): string {
    return `${formType.toUpperCase()}-${fiscalYear}-${recipientId.substring(0, 8)}`;
  }

  private _generateExportBatchId(): string {
    return `EXP-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private async _retrieveFormById(formId: string): Promise<Generated1099 | null> {
    // In a real implementation, query the generated 1099s table
    return null;
  }

  private _calculateNetAmount(gross: number): number {
    // For now, assume no withholding
    // If tax withholdings are needed, this would calculate: gross * withholding_rate
    return gross;
  }
}

/**
 * Tax Form Submission Service
 */
export class TaxFormSubmissionService {
  constructor(
    private w9Repo: W9Repository,
    private w8benRepo: W8BENRepository,
    private validationService: TaxFormValidationService
  ) {}

  /**
   * Submit a new W-9 form
   */
  async submitW9Form(freelancerId: string, data: any): Promise<TaxFormSubmissionResponse> {
    // Validate the form
    const validation = await this.validationService.validateW9Form(data);
    if (!validation.valid) {
      return {
        formId: '',
        formType: 'w9',
        status: 'pending',
        tin: data.tin,
        name: data.recipientName,
        validationErrors: validation.errors,
      };
    }

    // Create W-9 entity
    const entity = this._createW9Entity(freelancerId, data);
    
    // Store in repository
    const saved = await this.w9Repo.create(entity);
    
    return {
      formId: saved.id,
      formType: 'w9',
      status: saved.status,
      tin: saved.tin,
      name: saved.nameOnForm,
      expiresAt: saved.effectiveUntil,
    };
  }

  /**
   * Submit a new W-8BEN form
   */
  async submitW8BENForm(freelancerId: string, data: any): Promise<TaxFormSubmissionResponse> {
    const validation = await this.validationService.validateW8BENForm(data);
    if (!validation.valid) {
      return {
        formId: '',
        formType: 'w8ben',
        status: 'pending',
        tin: data.foreignTaxNumber || '',
        name: data.businessName,
        validationErrors: validation.errors,
      };
    }

    const entity = this._createW8BENEntity(freelancerId, data);
    const saved = await this.w8benRepo.create(entity);

    return {
      formId: saved.id,
      formType: 'w8ben',
      status: saved.status,
      tin: saved.foreignTaxNumber || '',
      name: saved.entityName,
    };
  }

  /**
   * Update an existing tax form
   */
  async updateTaxForm(
    formId: string,
    data: any
  ): Promise<TaxFormSubmissionResponse> {
    // Determine form type by checking repository
    const w9Form = await this.w9Repo.findById(formId);
    if (w9Form) {
      const validation = await this.validationService.validateW9Form(data);
      if (!validation.valid) {
        throw new TaxValidationError('formId', 'Validation failed', 'update');
      }
      const updated = await this.w9Repo.update(formId, data);
      return this._w9EntityToResponse(updated);
    }

    const w8benForm = await this.w8benRepo.findById(formId);
    if (w8benForm) {
      const validation = await this.validationService.validateW8BENForm(data);
      if (!validation.valid) {
        throw new TaxValidationError('formId', 'Validation failed', 'update');
      }
      const updated = await this.w8benRepo.update(formId, data);
      return this._w8benEntityToResponse(updated);
    }

    throw new Error('Form not found');
  }

  /**
   * Store uploaded scanned document for a tax form
   */
  async storeDocument(formId: string, documentUrl: string): Promise<void> {
    const w9Form = await this.w9Repo.findById(formId);
    if (w9Form) {
      await this.w9Repo.update(formId, { scannedDocumentUrl: documentUrl });
      return;
    }

    const w8benForm = await this.w8benRepo.findById(formId);
    if (w8benForm) {
      await this.w8benRepo.update(formId, { scannedDocumentUrl: documentUrl });
      return;
    }

    throw new Error('Form not found');
  }

  /* Private Helper Methods */

  private _createW9Entity(
    freelancerId: string,
    data: any
  ): W9Entity {
    return {
      id: this._generateId(),
      freelancerId,
      version: 1,
      submittedAt: new Date(),
      validFrom: new Date(),
      status: 'pending',
      taxpayerType: data.taxpayerType,
      tinType: data.tinType,
      tin: data.tin,
      nameOnForm: data.recipientName || data.businessName,
      businessName: data.businessName,
      address: {
        street_line1: data.address.streetLine1,
        street_line2: data.address.streetLine2,
        city: data.address.city,
        state: data.address.state,
        postal_code: data.address.postalCode,
        country: data.address.country,
      },
      formDataJson: JSON.stringify(data),
      uploadedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private _createW8BENEntity(
    freelancerId: string,
    data: any
  ): W8BENEntity {
    return {
      id: this._generateId(),
      freelancerId,
      version: 1,
      submittedAt: new Date(),
      validFrom: new Date(),
      status: 'pending',
      taxpayerType: data.taxpayerType,
      entityName: data.businessName,
      foreignTaxNumber: data.foreignTaxNumber,
      foreignAddress: {
        country: data.foreignAddress.country,
        street_line1: data.foreignAddress.streetLine1,
        street_line2: data.foreignAddress.streetLine2,
        city: data.foreignAddress.city,
        region: data.foreignAddress.region,
        postal_code: data.foreignAddress.postalCode,
      },
      beneficialOwner: data.beneficialOwner,
      formType: data.formType || 'w8ben',
      formDataJson: JSON.stringify(data),
      uploadedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private _w9EntityToResponse(entity: W9Entity): TaxFormSubmissionResponse {
    return {
      formId: entity.id,
      formType: 'w9',
      status: entity.status,
      tin: entity.tin,
      name: entity.nameOnForm,
      expiresAt: entity.effectiveUntil,
    };
  }

  private _w8benEntityToResponse(entity: W8BENEntity): TaxFormSubmissionResponse {
    return {
      formId: entity.id,
      formType: 'w8ben',
      status: entity.status,
      tin: entity.foreignTaxNumber || '',
      name: entity.entityName,
    };
  }

  private _generateId(): string {
    return `tax_form_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}