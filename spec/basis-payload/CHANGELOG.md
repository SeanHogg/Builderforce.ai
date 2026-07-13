# Basis Payload Specification Changelog

All notable changes to the Basis Payload Specification will be documented in this file.

## [1.0.0] - 2025-08-24

### Added
- Initial canonical specification for basis payload structure
- Schema versioning with SemVer approach
- Required identity block: `basis_id`, `created_at`, `agent_id`
- Claims block with confidence tracking
- Evidence block with provenance metadata
- Optional reasoning chain for step-by-step logic
- Optional uncertainty block for uncertainty summaries
- Context block with tool-call metadata
- Extensions block for domain-specific fields
- JSON Schema validation artifact (Draft 2020-12)
- Canonical example payload demonstrating all fields
- Validation rules and failure modes
- Security and privacy considerations

### Security
- Defined checksum field for evidence provenance
- Recommended `agent_id` cryptographic binding

### Privacy
- Identified sensitive fields requiring sanitization policy (text, excerpt)
- Defined PII handling requirements

## [Unreleased]

### Planned
- Consider adding `metadata` timestamp subfields
- Consider `result_type` discriminator

[1.0.0]: https://github.com/seanhogg/builderforce.ai/compare/v1.0.0...HEAD