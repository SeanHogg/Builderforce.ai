/**
 * Tax Form Validation Service
 * 
 * Validates submitted W-9 and W-8BEN forms against IRS requirements.
 */

import { z } from 'zod';
import { TaxValidationError } from '../..';
import { W9FormInput, W8BENFormInput } from '../../../types';

export class TaxValidationService {
  /**
   * Validate a W-9 form submission
   */
  static async validateW9Form(data: W9FormInput): Promise<{
    valid: boolean;
    errors: TaxValidationError[];
  }> {
    const errors: TaxValidationError[] = [];

    // Schema validation
    const schema = z.object({
      taxYear: z.number().int().min(2020).max(2099).optional(),
      taxpayerType: z.enum(['individual', 'corporation', 'partnership', 'llc', 'trust', 'trust_estate']),
      tinType: z.enum(['ssn', 'ein', 'itin']),
      tin: z.string().min(1),
      signature: z.object({
        signerName: z.string().min(1),
        signatureDate: z.date(),
      }),
      scannedDocument: z.any().optional(),
    });

    const result = schema.safeParse({
      ...data,
      taxYear: data.taxYear || new Date().getFullYear(),
    });

    if (!result.success) {
      result.error.errors.forEach((err) => {
        errors.push(new TaxValidationError(
          err.path[0]?.toString() || 'unknown',
          err.message
        ));
      });
    }

    // TIN validation
    errors.push(...this._validateTIN(data.tinType, data.tin));

    // Required field based on entity type
    if (data.taxpayerType === 'corporation' || data.taxpayerType === 'llc' || data.taxpayerType === 'partnership') {
      if (!data.businessName) {
        errors.push(new TaxValidationError(
          'businessName',
          'Business name is required for corporations, LLCs, and partnerships'
        ));
      }
    }

    // Business name validation (must not be the same as individual name)
    if (data.taxpayerType === 'individual') {
      errors.push(...this._validateIndividualBusinessName(data.recipientName, data.businessName));
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate a W-8BEN form submission
   */
  static async validateW8BENForm(data: W8BENFormInput): Promise<{
    valid: boolean;
    errors: TaxValidationError[];
  }> {
    const errors: TaxValidationError[] = [];

    const schema = z.object({
      formType: z.enum(['w8ben', 'w8ben_2020']),
      beneficialOwner: z.object({
        countryOfResidence: z.string().min(1),
        ownershipPercent: z.number().min(0).max(100).optional(),
        certification: z.boolean(),
      }).optional(),
      taxpayerType: z.enum(['individual', 'entity']),
      businessName: z.string().min(1),
      foreignTaxNumber: z.string().min(1).optional(),
      foreignAddress: z.object({
        country: z.string().min(1),
        streetLine1: z.string().min(1),
        city: z.string().optional(),
        region: z.string().optional(),
        postalCode: z.string().optional(),
      }),
      signature: z.object({
        signatoryName: z.string().min(1),
        signatureDate: z.date(),
      }),
    });

    const result = schema.safeParse(data);
    if (!result.success) {
      result.error.errors.forEach((err) => {
        errors.push(new TaxValidationError(
          err.path[0]?.toString() || 'unknown',
          err.message
        ));
      });
    }

    // Tax type validation
    if (data.taxpayerType === 'entity' && !data.businessName) {
      errors.push(new TaxValidationError(
        'businessName',
        'Legal business name must be provided for entity types'
      ));
    }

    // Beneficial owner certification if claiming exemption
    if (data.beneficialOwner?.certification) {
      errors.push(...this._validateBeneficialOwner(data.beneficialOwner));
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate TIN format based on type
   */
  private static _validateTIN(tinType: string, tin: string): TaxValidationError[] {
    const errors: TaxValidationError[] = [];

    // SSN: 9 digits, XXX-XX-XXXX format
    if (tinType === 'ssn' && tin.length === 9) {
      const ssnPattern = /^\d{3}[-.\s]\d{2}[-.\s]\d{4}$/;
      if (!ssnPattern.test(tin.replace(/[-.\s]/g, ''))) {
        errors.push(new TaxValidationError(
          'tin',
          'SSN must be in format XXX-XX-XXXX or XXXXX-XXXX'
        ));
      }
    }

    // EIN: 9 digits, XX-XXXXXXX or XXXXXXXX format
    if (tinType === 'ein' && tin.length === 9) {
      const einPattern = /^\d{2}[-.\s]\d{7}$|^\d{9}$/;
      if (!einPattern.test(tin.replace(/[-.\s]/g, ''))) {
        errors.push(new TaxValidationError(
          'tin',
          'EIN must be in format XX-XXXXXXX or XXXXXXXX'
        ));
      }
    }

    // ITIN: 9 digits starting with 9, 7-9, 0-3 or 5-9
    if (tinType === 'itin' && tin.length === 9) {
      const itinPattern = /^9\d{7}$/;
      if (!itinPattern.test(tin)) {
        errors.push(new TaxValidationError(
          'tin',
          'ITIN must be in the format 9XX-XX-XXXX'
        ));
      }
    }

    // Generic TIN must be numeric
    if (!/^\d+$/.test(tin.replace(/[-.\s]/g, ''))) {
      errors.push(new TaxValidationError(
        'tin',
        'TIN must contain only numbers and hyphens'
      ));
    }

    return errors;
  }

  /**
   * Validate individual vs business name logic
   */
  private static _validateIndividualBusinessName(
    individualName: string,
    businessName?: string
  ): TaxValidationError[] {
    const errors: TaxValidationError[] = [];

    if (!businessName) {
      return errors;
    }

    // Normalize strings for comparison
    const normalizedIndividual = individualName.toLowerCase().replace(/\s+/g, '');
    const normalizedBusiness = businessName.toLowerCase().replace(/\s+/g, '');

    if (normalizedIndividual === normalizedBusiness) {
      errors.push(new TaxValidationError(
        'businessName',
        'Business name must be different from individual name for individual taxpayers'
      ));
    }

    return errors;
  }

  /**
   * Validate beneficial owner information
   */
  private static _validateBeneficialOwner(owner?: {
    countryOfResidence: string;
    ownershipPercent?: number;
    certification: boolean;
  }): TaxValidationError[] {
    const errors: TaxValidationError[] = [];

    if (!owner) {
      return errors;
    }

    if (!owner.certification) {
      return errors;
    }

    if (owner.ownershipPercent === undefined) {
      errors.push(new TaxValidationError(
        'beneficialOwner.ownershipPercent',
        'Beneficial ownership percentage must be specified'
      ));
    }

    if (owner.ownershipPercent < 1) {
      errors.push(new TaxValidationError(
        'beneficialOwner.ownershipPercent',
        'Beneficial ownership percentage must be at least 1%'
      ));
    }

    if (owner.ownershipPercent > 100) {
      errors.push(new TaxValidationError(
        'beneficialOwner.ownershipPercent',
        'Beneficial ownership percentage cannot exceed 100%'
      ));
    }

    return errors;
  }

  /**
   * Validate IRS deadline compliance
   */
  static validateEfilingDeadline(fiscalYear: number, currentDate: Date): {
    compliant: boolean;
    deadlinePassed: boolean;
    daysUntilDeadline: number;
  } {
    // January 31: Deadline to print forms
    const printDeadline = new Date(fiscalYear, 0, 31);
    const daysUntilPrint = Math.ceil((printDeadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

    // February 28/29: Deadline to file forms (March 31 with extension)
    const filingDeadline = new Date(fiscalYear, 1, 28);
    const daysUntilFile = Math.ceil((filingDeadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

    const deadlinePassed = currentDate > filingDeadline;
    const compliant = !deadlinePassed;

    return {
      compliant,
      deadlinePassed,
      daysUntilPrint,
      daysUntilDeadline: daysUntilFile,
    };
  }
}