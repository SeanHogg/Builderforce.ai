# Tax Compliance (W-9/W-8BEN & 1099)

## Overview

This module implements comprehensive US tax compliance functionality for the platform, enabling:

1. **W-9/W-8BEN Form Collection:** Secure collection of tax forms from freelancers
2. **Tax Form Storage:** Encrypted storage with proper audit trails
3. **1099 Form Generation:** Automated generation of annual 1099-NEC/MISC forms
4. **E-filing Readiness:** Third-party integration for IRS e-filing

## Architecture

### Components

```
src/
├── data/
│   ├── types/
│   │   ├── tax.ts              # Domain models and interfaces
│   │   ├── dto.ts              # Request/response DTOs
│   │   └── async_task.ts       # Background task types
│   └── repository/
│       ├── base.ts             # Common repository interface
│       ├── w9_repository.ts    # W-9 data access
│       ├── w8ben_repository.ts # W-8BEN data access
│       └── index.ts            # Repository exports
├── models/
│   └── tax/
│       └── tax_form_entity.ts  # Database entities
├── services/
│   └── tax/
│       ├── tax_service.ts      # Core business logic
│       ├── validation_service.ts # Form validation
│       ├── record_keys.ts      # IRS constants
│       └── index.ts            # Service exports
├── api/
│   ├── routes/
│   │   └── tax_routes.ts       # RESTful API endpoints
│   └── migrations/
│       ├── 0034_create_w9_forms.sql
│       └── 0035_create_w8ben_forms.sql
└── services/tax/
    └── README.md               # This file
```

## Database Schema

### Tables

#### w9_forms
Stores W-9 tax forms for US persons and entities.

**Key Columns:**
- `id`: Primary key (UUID)
- `freelancer_id`: Foreign key to user profile
- `tin`: Tax Identification Number (SSN/EIN/ITIN)
- `taxpayer_type`: Legal entity type
- `address`: JSONB with USPS-standard fields
- `screed_document_url`: URL to uploaded PDF scan

**Constraints:**
- Unique constraint on (freelancer_id, tin, effective_until IS NULL)
- Foreign key to freelancer_profiles(id)

#### w8ben_forms
Stores W-8BEN tax forms for foreign persons and entities.

**Key Columns:**
- `id`: Primary key (UUID)
- `freelancer_id`: Foreign key to user profile
- `foreign_tax_number`: Foreign tax identification number
- `foreign_address`: JSONB with foreign address fields
- `beneficial_owner`: JSONB with ownership percentages
- `waiver_text`: Boolean for reduced rate/exemption claims

## Integration Guide

### 1. Onboarding Flow

When a new freelancer is onboarded:

```typescript
// Detect if freelancer is US-based
const isUSBased = await isFreelancerUSBased(freelancerId);

if (isUSBased) {
  // Request W-9 form
  await requestW9Form(freelancerId);
} else {
  // Request W-8BEN form (if applicable)
  await requestW8BENForm(freelancerId);
}
```

### 2. Form Submission

Freelancer submits tax form via API:

```typescript
// Example W-9 submission
POST /api/tax/forms/w9
{
  "taxpayerType": "individual",
  "tinType": "ssn",
  "tin": "123-45-6789",
  "recipientName": "John Doe",
  "businessName": null,
  "address": {
    "streetLine1": "123 Main St",
    "city": "Los Angeles",
    "state": "CA",
    "postalCode": "90210",
    "country": "US"
  },
  "signature": {
    "signerName": "John Doe",
    "signatureDate": "2024-01-15"
  }
}
```

### 3. Validation

Forms are automatically validated for:

- Required field presence
- TIN format (SSN/EIN/ITIN patterns)
- Entity-type specific requirements
- Business name vs individual name logic
- Beneficial owner certification claims

### 4. 1099 Generation

Annual tax reporting is automated:

```typescript
// Admin generates all 1099s for a fiscal year
POST /api/tax/1099s/generate
{
  "fiscalYear": 2024,
  "formType": "1099-NEC" // or "1099-MISC"
}
```

**Criteria for 1099 generation:**
- Payee has submitted W-9 form
- Payee received $600+ in payments
- Payment category is NEC or MISC
- Platform has reached IRS reporting threshold

### 5. E-filing

Forms are prepared for third-party e-filing:

```typescript
// Check e-filing requirements
GET /api/tax/1099s/:formId/efile/requirements

// Prepare for e-filing with a provider
POST /api/tax/1099s/:formId/efile
{
  "provider": "third-party-filing-service"
}
```

**Checklist for e-filing readiness:**
- Form status = 'ready'
- Recipient has complete TIN and address
- Scannable CMS-1500 form is available (PDF)
- E-filing deadline has not passed

## IRS Compliance

### Thresholds

**1099-NEC:** $600+ for nonemployee compensation
**1099-MISC:** $600+ for miscellaneous income

Deadlines (per calendar year):
- Print forms: January 31
- File forms: February 28 (March 31 with extension)

### retention_period

Forms are retained for 3 years (per IRS requirement):
- 1099s: 3 years from filing deadline
- Supporting bank records: 7 years

### Implementation Notes

1. **Payment Aggregation:** In a real implementation, this would join payments table with tax_forms table
2. **E-filing Integration:** This is a placeholder - actual integration with providers will require API credentials
3. **Audit Trail:** All form changes are logged with timestamps and reason codes
4. **Multiple Versions:** Forms store multiple versions with effective_until dates for updates

## Testing

### Unit Tests Required

- [ ] W-9 form validation (all field combinations)
- [ ] W-8BEN form validation (all field combinations)
- [ ] TIN format validation (SSN/EIN/ITIN)
- [ ] Entity-type specific rules
- [ ] Business name vs individual name logic
- [ ] Beneficial owner validation

### Integration Tests Required

- [ ] Form submission workflow
- [ ] Document upload and storage
- [ ] Form update/replacement
- [ ] 1099 generation for single payee
- [ ] 1099 generation for all payees
- [ ] E-filing requirement checks
- [ ] Third-party export format validation

## Migration Notes

### Existing Tables Affected

- `freelancer_profiles` - Added tax form ID references
- `payment_records` - Added `tax_form_id` foreign key

### New Tables

- `w9_forms` - Stores W-9 tax forms
- `w8ben_forms` - Stores W-8BEN tax forms

### Backward Compatibility

- Tax compliance is opt-in (you may still have no W-9 forms)
- 1099 generation automatically filters by flag to exclude non-US payees
- W-8BEN forms do not generate 1099s (they indicate foreign status)

## Security

### Data Protection

- Forms encrypted at rest (via DB encryption at rest)
- TIN information considered sensitive (PII)
- Access restricted to authorized users only
- Audit logs for all form access and modifications

### Access Control

**Freelancers:**
- View own tax forms
- Renew/update their forms

**Platform Admins:**
- View all tax forms
- Approve/reject forms for verification
- Generate 1099s
- Access e-filing details

## Future Enhancements

1. **OCR Integration:** Automatic document parsing with ID.me/Stripe docs integration
2. **Real-time Payments:** Integration for automatic 1099 generation on payment completion
3. **E-filing Providers:** Direct integration with providers (Justworks, Parade, Guideline)
4. **Multiple Currencies:** Support for cross-border payments
5. **State-specific Forms:** Additional state tax forms (W-8BEN-E, etc.)
6. **Self-Employment Tax:** Support for Schedule C-F attachment

## References

- [IRS Instructions for Form 1099-NEC](https://www.irs.gov/pub/irs-pdf/i1099nec.pdf)
- [IRS Instructions for Form W-9](https://www.irs.gov/pub/irs-pdf/iw9.pdf)
- [IRS Instructions for Form W-8BEN](https://www.irs.gov/pub/irs-pdf/fw8ben.pdf)
- [IRS Publication 544 (Sales and Other Dispositions of Assets)](https://www.irs.gov/publications/p544)
- [Form 1099 NEC vs MISC (IRS guidelines)](https://www.irs.gov/payments-taxes/business-irs-forms-forms-pubs/form-1099-series-quick-guide)