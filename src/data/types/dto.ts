/**
 * Tax Form DTOs (Data Transfer Objects)
 * 
 * Request/response models for tax form collection, validation, and management.
 */

import { z } from 'zod';

/**
 * Base W-9 form structure (input DTO)
 */
export interface W9FormInput {
  taxYear?: number;
  taxpayerType: 'individual' | 'corporation' | 'partnership' | 'llc' | 'trust' | 'trust_estate';
  tinType: 'ssn' | 'ein' | 'itin';
  tin: string;
  signature: {
    signerName: string;
    signatureDate: Date;
  };
  scannedDocument?: File;
}

/**
 * W-8BEN form input DTO
 */
export interface W8BENFormInput {
  beneficialOwner?: {
    countryOfResidence: string;
    ownershipPercent?: number;
    certification: boolean;
  };
  taxpayerType: 'individual' | 'entity';
  businessName: string;
  foreignTaxNumber?: string;
  foreignAddress: {
    country: string;
    streetLine1: string;
    streetLine2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
  };
  signature: {
    signatoryName: string;
    signatureDate: Date;
  };
}

/**
 * W-9/W-8BEN form submission response DTO
 */
export interface TaxFormSubmissionResponse {
  formId: string;
  formType: 'w9' | 'w8ben';
  status: 'pending' | 'submitted' | 'verified';
  tin: string;
  name: string;
  expiresAt?: Date;
  validationErrors?: Array<{
    field: string;
    message: string;
    category?: string;
  }>;
}

/**
 * 1099 Form Generation Request DTO
 */
export interface Generate1099Request {
  fiscalYear: number;
  formType: '1099-NEC' | '1099-MISC';
}

/**
 * 1099 Form Generation Response DTO
 */
export interface Generate1099Response {
  formId: string;
  formType: '1099-NEC' | '1099-MISC';
  fiscalYear: number;
  status: 'draft' | 'ready' | 'eFiled' | 'error';
  pdfUrl?: string;
  totalAmount: number;
  paymentCount: number;
  errors?: string[];
}

/**
 * E-filing Status DTO
 */
export interface EFileStatus {
  provider: string;
  trackingNumber?: string;
  confirmationNumber?: string;
  filedAt?: Date;
  status: 'ready' | 'filing' | 'submitted' | 'error';
  errorDetails?: string;
}

/**
 * 1099 Export DTO for third-party services (e.g., third-party 1099 filing API)
 */
export interface Tax1099Export {
  // Recipient Information
  recipientTin: string;
  recipientName: string;
  recipientAddress: TaxAddressForExport;

  // Financial Summary
  totalAmount: number;
  paymentCount: number;
  payments: PaymentRecordExport[];

  // IRS Target Category (NULL requires direct filing)
  irsTargetCategory?: string | null;

  // Export Metadata
  exportDate: Date;
  exportBatchId?: string;
}

/**
 * Address for export (matching Form 1099 format)
 */
export interface TaxAddressForExport {
  streetLine1: string;
  streetLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/**
 * Payment record for export
 */
export interface PaymentRecordExport {
  invoiceId?: string;
  amount: number;
  currency: string;
  paymentDate: Date;
  category?: 'nec' | 'misc';
}

/**
 * Tax form list request parameters
 */
export interface TaxFormListParams {
  formType?: 'w9' | 'w8ben';
  status?: string;
  fiscalYear?: number;
  limit?: number;
  offset?: number;
  freelancerId?: string;
}

/**
 * Tax form list response
 */
export interface TaxFormListResponse {
  items: TaxFormSubmissionResponse[];
  total: number;
  page: number;
  pageSize: number;
}