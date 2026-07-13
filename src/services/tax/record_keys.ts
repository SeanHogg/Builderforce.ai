/**
 * Constants for tax form record keys and IRSTAXCATEGORY membership
 *
 * Mapping to IRS Form 1099 categories (IRSTAXCATEGORY table)
 * NEC: 1099-NEC (nonemployee compensation)
 * MISC: 1099-MISC (miscellaneous)
 */

export const TaxCategories = {
  NEC: 'nec',
  MISC: 'misc',
} as const;

/**
 * IRSTAXCATEGORY membership for key IRS form types.
 * These are used to flag records for statutory period and validation.
 */
export const IRSTAXCATEGORY = {
  /**
   * 1099-NEC (Nonemployee Compensation)
   * Represents compensation paid for services performed, independent contractor
   * payments for non-qualified personal services.
   */
  NEC: 'nec',

  /**
   * 1099-MISC (Miscellaneous Information)
   * Use for rent, royalties (including critical-third-party payments),
   * medical health care payments, crop insurance proceeds, certain other payments.
   */
  MISC: 'misc',
} as const;

/**
 * The IRSTAXCATEGORY values for quick boolean lookup.
 */
export type IrCategory = typeof IRSTAXCATEGORY[keyof typeof IRSTAXCATEGORY];

/**
 * Whether a record is subject to a statutory reporting period (3 years).
 */
export const RETENTION_PERIOD = 3; // years

/**
 * Allowed tax form types we preserve.
 * For IRS reporting we map W-9 -> NEC (Service provider in US)
 * W-8BEN -> Not a US payer, so no NEC reporting against it itself;
 * W-8BEN indicates the payee is foreign and we do not perform NEC reporting
 * in the entity set—we may generate W-8BEN for the entity's own treasury for
 * internal disclosure. NEC records can drive 1099-NEC to the tax authority.
 */
export const AllowedTaxForms = [
  TaxCategories.NEC, // W-9 based (US individual/Entity)
  TaxCategories.MISC, // W-9 based if services not NEC-qualifying (historical path)
] as const;

/**
 * Get IRSTAXCATEGORY by tax form category
 */
export function getIrCategory(taxCategory: typeof TaxCategories[keyof typeof TaxCategories]): IrCategory {
  if (taxCategory === TaxCategories.NEC) {
    return IRSTAXCATEGORY.NEC;
  }
  if (taxCategory === TaxCategories.MISC) {
    return IRSTAXCATEGORY.MISC;
  }
  throw new Error(`Unsupported tax category: ${taxCategory}`);
}

/**
 * Validate categories against the allowed set.
 */
export function validateCategory(taxCategory: string): taxCategory is typeof TaxCategories[keyof typeof TaxCategories] {
  return Object.values(TaxCategories).includes(taxCategory as typeof TaxCategories[keyof typeof TaxCategories]);
}