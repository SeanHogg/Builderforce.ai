/**
 * Tax Validation Service Tests
 * 
 * Unit tests for W-9 and W-8BEN form validation logic.
 */

import { TaxFormValidationService, TaxValidationError } from '../validation_service';
import { W9FormInput, W8BENFormInput } from '../../../data/types';

describe('TaxFormValidationService', () => {
  describe('validateW9Form', () => {
    it('should validate a complete valid W-9 form', async () => {
      const validW9: W9FormInput = {
        taxYear: 2024,
        taxpayerType: 'individual',
        tinType: 'ssn',
        tin: '123-45-6789',
        recipientName: 'John Doe',
        businessName: 'Doe Consulting LLC',
        signature: {
          signerName: 'John Doe',
          signatureDate: new Date('2024-01-15'),
        },
        address: {
          streetLine1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
        },
      };

      const result = await TaxFormValidationService.validateW9Form(validW9);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for incomplete W-9 form', async () => {
      const incompleteW9: Partial<W9FormInput> = {
        taxpayerType: 'individual',
        tinType: 'ssn',
        tin: '123-45-6789',
        // Missing signature, address, recipientName, etc.
      };

      const result = await TaxFormValidationService.validateW9Form(incompleteW9 as W9FormInput);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should fail SSN format validation for invalid SSN', async () => {
      const invalidSSN: W9FormInput = {
        taxpayerType: 'individual',
        tinType: 'ssn',
        tin: '123-4a-6789', // Contains letter
        recipientName: 'John Doe',
        signature: {
          signerName: 'John Doe',
          signatureDate: new Date('2024-01-15'),
        },
        address: {
          streetLine1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
        },
      };

      const result = await TaxFormValidationService.validateW9Form(invalidSSN);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'tin' && e.message.includes('format'))).toBe(true);
    });

    it('should fail SSN format for non-numeric characters', async () => {
      const invalidSSN: W9FormInput = {
        taxpayerType: 'individual',
        tinType: 'ssn',
        tin: '123-45-ABC', // Contains letters
        recipientName: 'John Doe',
        signature: {
          signerName: 'John Doe',
          signatureDate: new Date('2024-01-15'),
        },
        address: {
          streetLine1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
        },
      };

      const result = await TaxFormValidationService.validateW9Form(invalidSSN);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'tin')).toBe(true);
    });

    it('should validate EIN format correctly', async () => {
      const validEIN: W9FormInput = {
        taxpayerType: 'corporation',
        tinType: 'ein',
        tin: '12-3456789', // Standard EIN format
        recipientName: 'XYZ Corporation',
        signature: {
          signerName: 'John Doe',
          signatureDate: new Date('2024-01-15'),
        },
        address: {
          streetLine1: '123 Business Lane',
          city: 'Chicago',
          state: 'IL',
          postalCode: '60601',
          country: 'US',
        },
        businessName: 'XYZ Corporation',
      };

      const result = await TaxFormValidationService.validateW9Form(validEIN);

      expect(result.valid).toBe(true);
    });

    it('should validate ITIN correctly', async () => {
      const validITIN: W9FormInput = {
        taxpayerType: 'individual',
        tinType: 'itin',
        tin: '923-45-6789', // ITIN format (9xx...)
        recipientName: 'Maria Garcia',
        signature: {
          signerName: 'Maria Garcia',
          signatureDate: new Date('2024-01-15'),
        },
        address: {
          streetLine1: '456 West Ave',
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90001',
          country: 'US',
        },
      };

      const result = await TaxFormValidationService.validateW9Form(validITIN);

      expect(result.valid).toBe(true);
    });

    it('should require business name for non-individual taxpayers', async () => {
      const corporationWithoutBusinessName: W9FormInput = {
        taxpayerType: 'corporation',
        tinType: 'ein',
        tin: '12-3456789',
        recipientName: 'XYZ Corporation',
        signature: {
          signerName: 'John Doe',
          signatureDate: new Date('2024-01-15'),
        },
        address: {
          streetLine1: '123 Business Lane',
          city: 'Chicago',
          state: 'IL',
          postalCode: '60601',
          country: 'US',
        },
        // Missing businessName
      };

      const result = await TaxFormValidationService.validateW9Form(corporationWithoutBusinessName);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'businessName' && e.message.includes('required'))).toBe(true);
    });

    it('should prevent same name for individual and business', async () => {
      const individualWithSameName: W9FormInput = {
        taxpayerType: 'individual',
        tinType: 'ssn',
        tin: '123-45-6789',
        recipientName: 'John Doe Consulting',
        businessName: 'John Doe Consulting', // Same as individual name
        signature: {
          signerName: 'John Doe',
          signatureDate: new Date('2024-01-15'),
        },
        address: {
          streetLine1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
        },
      };

      const result = await TaxFormValidationService.validateW9Form(individualWithSameName);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'businessName' && e.message.includes('different'))).toBe(true);
    });
  });

  describe('validateW8BENForm', () => {
    it('should validate a complete valid W-8BEN form', async () => {
      const validW8BEN: W8BENFormInput = {
        beneficialOwner: {
          countryOfResidence: 'CA',
          ownershipPercent: 100,
          certification: true,
        },
        taxpayerType: 'individual',
        businessName: 'Acme Ltd.',
        foreignTaxNumber: '123456789',
        foreignAddress: {
          country: 'CA',
          streetLine1: '123 Maple Dr',
          city: 'Toronto',
        },
        signature: {
          signatoryName: 'John Smith',
          signatureDate: new Date('2024-01-15'),
        },
        waiverText: false,
      };

      const result = await TaxFormValidationService.validateW8BENForm(validW8BEN);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require beneficial owner certification for reduced rate claims', async () => {
      const W8BENWithoutCertification: W8BENFormInput = {
        beneficialOwner: {
          countryOfResidence: 'CA',
          ownershipPercent: 100,
          certification: false, // Should be true for reduced rate
        },
        taxpayerType: 'individual',
        businessName: 'Acme Canada Ltd.',
        foreignTaxNumber: '123456789',
        foreignAddress: {
          country: 'CA',
          streetLine1: '123 Maple Dr',
          city: 'Toronto',
        },
        signature: {
          signatoryName: 'John Smith',
          signatureDate: new Date('2024-01-15'),
        },
      };

      const result = await TaxFormValidationService.validateW8BENForm(W8BENWithoutCertification);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'beneficialOwner.ownershipPercent')).toBe(true);
    });

    it('should validate foreign tax number format', async () => {
      const invalidForeignTaxNumber: W8BENFormInput = {
        beneficialOwner: {
          countryOfResidence: 'CA',
          ownershipPercent: 100,
          certification: true,
        },
        taxpayerType: 'entity',
        businessName: 'Bad Tax Number Inc.',
        foreignTaxNumber: 'ABC-123', // Invalid format
        foreignAddress: {
          country: 'CA',
          streetLine1: '123 Maple Dr',
          city: 'Toronto',
        },
        signature: {
          signatoryName: 'John Smith',
          signatureDate: new Date('2024-01-15'),
        },
      };

      const result = await TaxFormValidationService.validateW8BENForm(invalidForeignTaxNumber);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'foreignTaxNumber' && e.message.includes('Invalid'))).toBe(true);
    });

    it('should allow individual W-8BEN without foreign tax number', async () => {
      const individualW8BENWithoutForeignTax: W8BENFormInput = {
        beneficialOwner: {
          countryOfResidence: 'CA',
          ownershipPercent: 100,
          certification: true,
        },
        taxpayerType: 'individual',
        businessName: 'John Smith',
        // foreignTaxNumber is optional
        foreignAddress: {
          country: 'CA',
          streetLine1: '123 Maple Dr',
          city: 'Toronto',
        },
        signature: {
          signatoryName: 'John Smith',
          signatureDate: new Date('2024-01-15'),
        },
      };

      const result = await TaxFormValidationService.validateW8BENForm(individualW8BENWithoutForeignTax);

      expect(result.valid).toBe(true);
    });
  });

  describe('validateEfilingDeadline', () => {
    it('should determine compliant date when before deadline', () => {
      const deadline = TaxFormValidationService.validateEfilingDeadline(2024, new Date('2024-01-30'));

      expect(deadline.compliant).toBe(true);
      expect(deadline.deadlinePassed).toBe(false);
      expect(deadline.daysUntilDeadline).toBeGreaterThan(0);
    });

    it('should determine non-compliant after deadline', () => {
      const deadlineAfter = TaxFormValidationService.validateEfilingDeadline(2024, new Date('2024-03-01'));

      expect(deadlineAfter.compliant).toBe(false);
      expect(deadlineAfter.deadlinePassed).toBe(true);
    });

    it('should handle deadline on February 28/29', () => {
      // Feb 28, 2024 (leap year)
      const feb28 = TaxFormValidationService.validateEfilingDeadline(2024, new Date('2024-02-28'));

      expect(feb28.compliant).toBe(true);
      expect(feb28.daysUntilDeadline).toBe(0);
    });
  });
});