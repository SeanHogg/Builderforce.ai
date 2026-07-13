/**
 * Tax Form Database Entities
 * 
 * Domain models for storing W-9 and W-8BEN forms in the database.
 */

export enum TaxFormStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  VERIFIED = 'verified',
  EXPIRED = 'expired',
  ARCHIVED = 'archived',
}

export enum TaxEntityType {
  INDIVIDUAL = 'individual',
  CORPORATION = 'corporation',
  PARTNERSHIP = 'partnership',
  LLC = 'llc',
  TRUST = 'trust',
  TRUST_ESTATE = 'trust_estate',
  UNKNOWN = 'unknown',
}

export enum TaxTINType {
  SSN = 'ssn',
  EIN = 'ein',
  ITIN = 'itin',
}

/**
 * W-9 Database Entity
 */
export interface W9Entity {
  id: string;
  freelancerId: string;
  version: number;
  
  // Form metadata
  submittedAt: Date;
  validFrom: Date;
  effectiveUntil?: Date;
  status: TaxFormStatus;
  
  // Tax classification
  taxpayerType: TaxEntityType;
  tinType: TaxTINType;
  tin: string;
  nameOnForm: string;
  businessName?: string;
  
  // Address
  address: TaxAddress;
  
  // Additional fields
  accountNumbers?: string;
  statementTransactions?: boolean;
  waiverCheckbox?: boolean;
  resetEIN?: boolean;
  
  // Document metadata
  formDataJson: string; // Deep copy of submitted form
  scannedDocumentUrl?: string;
  uploadedAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
  
  // Metadata for queries
  irsTargetCategory?: string; // IRSTAXCATEGORY
  indexedByCreator?: boolean;
}

/**
 * W-8BEN Database Entity
 */
export interface W8BENEntity {
  id: string;
  freelancerId: string;
  version: number;
  
  // Form metadata
  submittedAt: Date;
  validFrom: Date;
  status: TaxFormStatus;
  
  // Tax classification
  foreignTaxNumber?: string;
  taxpayerType: 'individual' | 'entity';
  entityName: string;
  foreignAddress: ForeignTaxAddress;
  
  // Exemption claim
  beneficialOwner?: {
    countryOfResidence: string;
    ownershipPercent?: number;
    certification: boolean;
  };
  
  waiverText?: boolean;
  
  // Archive
  archiveReason?: string;
  archivedAt?: Date;
  
  // Document metadata
  formType: 'w8ben' | 'w8ben_2020';
  formDataJson: string;
  scannedDocumentUrl?: string;
  uploadedAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
  
  // Metadata
  indexedByCreator?: boolean;
}

/**
 * Payment Record Entity
 */
export interface PaymentEntity {
  id: string;
  freelancerId: string;
  invoiceId?: string;
  
  amount: number;
  currency: string;
  paymentDate: Date;
  
  category: 'nec' | 'misc' | null;
  
  status: 'completed' | 'pending' | 'void';
  
  metadataJson?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 1099 Generated Form Entity
 */
export interface Generated1099Entity {
  id: string;
  fiscalYear: number;
  formType: '1099-NEC' | '1099-MISC';
  
  // Recipient
  recipientId: string;
  
  // Fiscal period (calendar year)
  taxYear: number;
  
  summary: {
    count: number;
    totalAmount: number;
    timestamp: Date;
  };
  
  status: 'draft' | 'ready' | 'e_filed' | 'error';
  
  documents?: {
    pdf_url: string;
    e_file_package_url?: string;
    internal_report_url?: string;
  };
  
  e_filing?: {
    provider: string;
    fta_id?: string;
    tracking_number?: string;
    filed_at?: Date;
    confirmation_number?: string;
  };
  
  created_at: Date;
  updated_at: Date;
}

/**
 * Address types
 */
export interface TaxAddress {
  street_line1: string;
  street_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface ForeignTaxAddress {
  country: string;
  city?: string;
  region?: string;
  postal_code?: string;
  street_line1: string;
  street_line2?: string;
}