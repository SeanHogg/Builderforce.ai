/**
 * Tax Compliance Configuration
 * 
 * Configuration constants for tax compliance thresholds and IRS guidelines.
 */

/**
 * IRS Reporting Thresholds (in dollars)
 */
export const IRSThresholds = {
  /** 
   * 1099-NEC (Nonemployee Compensation) 
   * Minimum payments before 1099-NEC filing is required 
   */
  NEC: 600,

  /** 
   * 1099-MISC (Miscellaneous) 
   * Minimum payments before 1099-MISC filing is required 
   */
  MISC: 600,
} as const;

/**
 * E-filing Deadlines (per fiscal year)
 * Calculated based on calendar year
 */
export const EfilingDeadlines = {
  /** Deadline to print forms - January 31 per IRS instructions */
  printDeadline: new Date(2099, 0, 31), // Year is relative, will be replaced in code

  /** Deadline to file forms - February 28 (March 31 with extension) */
  filingDeadline: new Date(2099, 1, 28), // Year is relative, will be replaced in code

  /** Extension deadline - April 15 */
  extensionDeadline: new Date(2099, 3, 15),
} as const;

/**
 * IRS Penalty Rates
 */
export const IRSPenalties = {
  /** Late filing penalty (per form, 5% per month over deadline) */
  lateFiling: 0.05,

  /** Late payment penalty (late payment, 0.5% per month) */
  latePayment: 0.005,

  /** Accuracy-related penalty (0.5% - 20% of underpayment) */
  accuracyRelated: 0.20,

  /** Failure to file penalty (civil penalty up to $250 per form) */
  failureToFile: 250,

  /** Failure to pay penalty (civil penalty up to 25% of unpaid tax) */
  failureToPay: 0.25,
} as const;

/**
 * Record Retention Periods (per IRS guidelines)
 */
export const RetentionPeriods = {
  /** 
   * 1099 forms - 3 years from filing deadline 
   * (Tax audit period starts January 1 of second year after filing)
   */
  form1099: 3,

  /** Supporting bank records - 7 years */
  supportingRecords: 7,

  /** W-9 forms - 4 years (retained after form accepted) */
  w9Forms: 4,

  /** W-8BEN forms - 4 years (retained until replaced) */
  w8benForms: 4,

  /** Other tax documents - 4 years */
  otherTaxDocuments: 4,
} as const;

/**
 * Address Validation Config
 */
export const AddressValidationConfig = {
  /** Returns must be in the US (departments but not country is mandatory) */
  requireAllFields: true,

  /** USPS address guidelines */
  streetLine1: {
    maxLength: 100,
  },
  
  streetLine2: {
    maxLength: 100,
  },

  city: {
    maxLength: 50,
  },

  state: {
    minLength: 2,
    maxLength: 2, // Two-letter state codes
    required: true,
  },

  postalCode: {
    minLength: 5,
    maxLength: 10, // 9-digit ZIP+4
    pattern: /^(?:[0-9]{5})?(?:[-\s]?[0-9]{4})?$/,
    required: true,
  },

  country: {
    required: true,
    alpha2: true, // ISO 3166-1 alpha-2 country codes
  },
} as const;

/**
 * TIN Validation Patterns
 */
export const TINValidationPatterns = {
  /** SSN: 9 digits, XXX-XX-XXXX or XXXXX-XXXX */
  SSN: {
    pattern: /^\d{9}$/,
    formatted: /^(?:\d{3}[-.\s]?|\d{5}[-.\s]?)\d{2}[-.\s]?\d{4}$/,
  },

  /** EIN: 9 digits, XX-XXXXXXX or XXXXXXXX */
  EIN: {
    pattern: /^\d{9}$/,
    formatted: /^(?:\d{2}[-.\s]?|(?!\d{2})\d{3}[-.\s]?)\d{5,7}$/, // Starts with number 0-9, Group of 2 or 9
  },

  /** ITIN: 9 digits starting with 9, 7-9, 0-3 or 5-9 */
  ITIN: {
    pattern: /^9\d{7}$/,
  },

  /** Generic numeric only validation */
  numericOnly: /^\d+$/,
} as const;

/**
 * Beneficial Owner Requirements
 */
export const BeneficialOwnerRequirements = {
  /** Must be at least 1% ownership */
  minOwnershipPercent: 1,

  /** Maximum ownership percent */
  maxOwnershipPercent: 100,

  /** Must certify ownership for reduced rate claims */
  requiredCertification: true,

  /** List of countries that can claim reduced withholding */
  reducedRateCountries: [
    'CA', 'FR', 'DE', 'GB', 'IT', 'NL', 'JP', 'AU', 'CH', 'BE', 'ES', 'SE', 'GB',
    // Add more countries as needed
  ],
} as const;

/**
 * State-Specific Requirements
 */
export const StateSpecificRequirements = {
  /** States that require withholding for non-resident searches */
  requiresResidencyCheck: [
    'CA', 'NY', 'MA', 'OR', 'WA', 'VT', 'UT', 'OH', 'IN', 'MI',
    // Add more states as needed
  ],

  /** States with different residency verification rules */
  hasResidencyVerification: {
    CA: {
      requires_driver_license: true,
      requires_address_verification: ['CA', 'OR', 'WA'],
    },
    NY: {
      requires_certified_residence_proof: true,
    },
    /* Add state-specific rules */
  },
} as const;

/**
 * Session and Validation
 */
export const ValidationSettings = {
  /** Maximum number of validation errors before rejecting form */
  maxErrors: 100,

  /** Email address regex for signatory validation */
  emailRegex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  /** Allow unknown fields in form data (for future-proofing) */
  allowUnknownFields: false,

  /** Log validation attempts for audit */
  logValidationAttempts: true,
} as const;

/**
 * API Configuration
 */
export const APIConfiguration = {
  /** CORS origins for tax API */
  corsOrigins: [
    'https://builderforce.ai',
  ],

  /** Rate limiting for endpoints that could be abused */
  rateLimits: {
    submitForm: {
      requestsPerHour: 24, // 1 per hour
    },
    generate1099s: {
      requestsPerDay: 5,
    },
    checkEfileStatus: {
      requestsPerHour: 60,
    },
  },

  /** JWT expiration for tax form tokens */
  jwtExpirationMinutes: 30,
} as const;

/**
 * Helper function to calculate e-filing deadlines for a specific fiscal year
 */
export function calculateEfilingDeadlines(specifiedFiscalYear: number): {
  printDeadline: Date;
  filingDeadline: Date;
  extensionDeadline: Date;
} {
  return {
    printDeadline: new Date(specifiedFiscalYear, 0, 31),
    filingDeadline: new Date(specifiedFiscalYear, 1, 28),
    extensionDeadline: new Date(specifiedFiscalYear, 3, 15),
  };
}