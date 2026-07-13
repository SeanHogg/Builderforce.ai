/**
 * Tax Compliance Data Types
 * 
 * Complete type definitions for W-9/W-8BEN tax form collection, storage, 
 * and 1099 generation.
 */

import { z } from 'zod';
import { AllowedTaxForms, TaxCategories, IRSTAXCATEGORY } from '../services/tax/record_keys';

/**
 * Legal entity types for tax reporting
 */
export enum LegalEntityType {
  INDIVIDUAL = 'individual',
  CORPORATION = 'corporation',
  PARTNERSHIP = 'partnership',
  LLC = 'llc',
  TRUST = 'trust',
  TRUST_ESTATE = 'trust_estate',
  UNKNOWN = 'unknown',
}

/**
 * W-9 Tax Form (US Person or Entity)
 * @see https://www.irs.gov/instructions/i1099nec
 */
export interface W9Form {
  id: string;
  freelancerId: string;
  version: number;
  
  // Form metadata
  submittedAt: Date;
  versionedAt: Date;
  validFrom: Date;
  effectiveUntil?: Date; // Employment termination
  status: 'pending' | 'submitted' | 'verified' | 'expired';
  
  // Tax classification
  taxpayerType: LegalEntityType;
  tinType: TINType;
  tin: string; // SSN, EIN, or ITIN
  nameOnForm: string;
  businessName?: string;
  
  // Address information
  address: TaxAddress;
  
  // Optional fields based on entity type
  accountNumbers?: string;
  statementTransactions?: boolean;
  waiverCheckbox?: boolean;
  resetEIN?: boolean;
  
  // Audit trails
  formDataJson: string; // Full submitted form as JSON
  scannedDocumentUrl?: string;
  uploadedAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * W-8BEN Tax Form (Foreign Person)
 * @see https://www.irs.gov/pub/irs-pdf/fw8ben.pdf
 */
export interface W8BENForm {
  id: string;
  freelancerId: string;
  version: number;
  
  // Form metadata
  submittedAt: Date;
  versionedAt: Date;
  validFrom: Date;
  status: 'pending' | 'submitted' | 'verified';
  
  // Tax classification
  foreignTaxNumber?: string; // Foreign tax ID
  taxpayerType: 'individual' | 'entity';
  entityName: string;
  foreignAddress: ForeignTaxAddress;
  
  // Exemption claim
  beneficialOwner?: {
    countryOfResidence: string;
    ownershipPercent?: number;
    certification: boolean; // sf-w8ben-011
  };
  
  waiverText?: boolean; // Eligible for simplified method
  
  // Archive information
  archiveReason?: string;
  archivedAt?: Date;
  
  // Audit trails
  formType: 'w8ben' | 'w8ben_2020';
  formDataJson: string;
  scannedDocumentUrl?: string;
  uploadedAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tax Address Information
 */
export interface TaxAddress {
  streetLine1: string;
  streetLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/**
 * Foreign Tax Address (for W-8BEN)
 */
export interface ForeignTaxAddress {
  country: string;
  city?: string;
  region?: string;
  postalCode?: string;
  streetLine1: string;
  streetLine2?: string;
}

/**
 * Tax identification number type
 */
export enum TINType {
  SSN = 'ssn',
  EIN = 'ein',
  ITIN = 'itin',
}

/**
 * 1099 Form Generation
 */
export interface TaxFormTypeMap {
  nec: W9Form;      // 1099-NEC
  misc: W9Form;     // 1099-MISC
}

type TaxFormFor1099<T extends keyof TaxFormTypeMap> = Required<TaxFormTypeMap[T]>;

/**
 * Payment record for 1099 aggregation
 */
export interface PaymentRecord {
  id: string;
  freelancerId: string;
  invoiceId?: string;
  
  // Financial details
  amount: number;
  currency: string;
  paymentDate: Date;
  
  // Tax classification
  category: TaxCategories | null;
  
  // Status
  status: 'completed' | 'pending' | 'void';
  
  // Metadata
  metadataJson?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 1099 Form (generated)
 */
export interface Generated1099 {
  id: string;
  fiscalYear: number;
  formType: '1099-NEC' | '1099-MISC';
  irsTargetCategory: string; // IRSTAXCATEGORY
  
  // Recipient information
  recipientId: string;
  recipient details: {
    name: string;
    tin: string;
    address: TaxAddress;
  };
  
  // Financial summary
  totalPayments: {
    count: number;
    totalAmount: number;
    grossAmount: number;
    netAmount?: number;
    withholdAmount?: number;
  };
  
  // Payments detail for the form
  payments: PaymentRecord[];
  
  // Generation metadata
  generatedAt: Date;
  lastModifiedAt: Date;
  status: 'draft' | 'ready' | 'eFiled' | 'error';
  
  // E-filing
  eFiling?: {
    provider: string;
    ftaId?: string;
    trackingNumber?: string;
    filedAt?: Date;
    confirmationNumber?: string;
  };
  
  // Generated documents
  documents?: {
    pdfUrl: string;
    eFilePackageUrl?: string;
    internalReportUrl?: string;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tax form validation error
 */
export class TaxValidationError extends Error {
  constructor(
    public field: string,
    public message: string,
    public category?: string
  ) {
    super(`${field}: ${message}`);
    this.name = 'TaxValidationError';
  }
}

/**
 * Validation schemas
 */

export const W9FormSchema = z.object({
  // Header info
  taxYear: z.number().int().min(2020).max(2099),
  taxpayerType: z.enum(['individual', 'corporation', 'partnership', 'llc', 'trust', 'trust_estate']),
  
  // TIN
  tinType: z.enum(['ssn', 'ein', 'itin']),
  tin: z.string().min(1),
  
  // Names
  recipientName: z.string(),
  businessName: z.string().optional(),
  legalBusinessName: z.string().optional(),
  
  // Address
  address: z.object({
    streetLine1: z.string().min(1),
    streetLine2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().min(2).max(2),
    postalCode: z.string().min(1).max(5),
    country: z.string(),
  }),
  
  // Additional fields
  accountNumbers: z.string().optional(),
  resetEIN: z.boolean().optional(),
  
  // Signature mock
  signature: z.optional(z.object({
    signerName: z.string(),
    signatureDate: z.date(),
  })),
  
  // Attachments
  scannedDocument: z.optional(z.any()),
});

export const W8BENFormSchema = z.object({
  // Header
  formType: z.enum(['w8ben', 'w8ben_2020']),
  beneficialOwner: z.optional(z.object({
    countryOfResidence: z.string(),
    ownershipPercent: z.number().min(0).max(100),
    certification: z.boolean(),
  })),
  
  // Tax classification
  foreignTaxNumber: z.string().optional(),
  taxpayerType: z.enum(['individual', 'entity']),
  businessName: z.string(),
  foreignAddress: z.object({
    country: z.string(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    streetLine1: z.string(),
    streetLine2: z.string().optional(),
  }),
  
  // Waiver or simplified
  waiverText: z.boolean().optional(),
  
  // Signature mock
  signature: z.optional(z.object({
    signatoryName: z.string(),
    signatureDate: z.date(),
  })),
  
  // Attachments
  scannedDocument: z.optional(z.any()),
});

/**
 * IRS 1099 threshold (in dollars)
 */
export const IRS_THRESHOLD = 600;

/**
 * E-filing deadlines
 */
export interface EFilingDeadlines {
  lastDayOfPrint: Date;
  finalDayOfFiling: Date;
  lastDayOfExtension: Date;
}

// These would be calculated dynamically based on the fiscal year
export const calculateEfilingDeadlines = (fiscalYear: number): EFilingDeadlines => {
  // Example: Always print by January 31, file by February 28 (or March 31 with extension)
  return {
    lastDayOfPrint: new Date(fiscalYear, 0, 31),
    finalDayOfFiling: new Date(fiscalYear, 1, 28),
    lastDayOfExtension: new Date(fiscalYear, 2, 31),
  };
};