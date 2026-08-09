# Engineering rules

These rules apply to every change in this repository.

## Required design principles

- **DRY:** Keep each policy, transformation, contract, and reusable UI behavior in one canonical implementation. Reuse or extract shared code instead of copying logic or markup. Do not introduce an abstraction until there is a real shared responsibility.
- **SOLID:** Keep units focused, extend behavior through explicit interfaces and composition, preserve substitutability, expose narrow consumer-specific contracts, and depend on abstractions at architectural boundaries. Avoid multipurpose components, broad service interfaces, and hidden coupling.
- **N-layer architecture:** Preserve the presentation → application → domain → infrastructure dependency direction. Presentation code owns view state, application code coordinates use cases, domain code owns business rules, and infrastructure code implements storage and runtime adapters. Domain code must not depend on presentation or infrastructure details.
- **Localization:** All user-visible copy must come from the localization system. Add or update keys in every supported locale catalog in the same change. Do not hard-code labels, placeholders, notices, accessibility text, tooltips, or empty/error states in UI components.
- **Registry-driven localization:** Any registry, configuration array, or data model that stores localization keys must have a focused test which resolves every referenced key against every supported locale. Catalog-to-catalog parity is not sufficient because a key can be absent from all catalogs. Adding or changing a `labelKey`, `titleKey`, `descriptionKey`, or equivalent is incomplete until the source-to-catalog test passes.

## Completion check

Before considering work complete, review changed code for duplication, responsibility leakage, layer violations, and untranslated user-facing strings. Treat violations as blockers and run the relevant typechecks and focused tests. When a change touches localized copy or a localization-key registry, `frontend/src/i18n/messages.test.ts` is a required focused test.
