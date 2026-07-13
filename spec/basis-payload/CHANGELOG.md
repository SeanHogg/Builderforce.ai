# Changelog

All notable changes to the Basis Payload specification contract will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2025-06-18

### Added

**First ratification of Basis Payload Contract v1.0.0.**
- Canonical JSON Schema (Draft 2020-12) under `spec/basis-payload/basis-payload.schema.json`.
- Full canonical example payload under `spec/basis-payload/example.canonical.json` with extensions (com.builderforce.review + com.acme.risk).
- Reference documentation (`basis-payload.md`) with field definitions, semantics, integration guidelines, and requirement traceability.
- Quick-start and validation packaging (`validate.js` for CLI validation).
- Directory README with requirement traceability, extension guidance, AC resolutions, and version handling.
- Design document timestamp positioning at PRD.md (shared across tasks #659a c25/1234; experimental).
- PRD.md ratified with Review and Test Evidence sections marked Complete and QC passes).
- Decode partial qualifier 6.04/6.16 parts to EXAMPLE 4/6.16 with mock CLAIM 6.20 reserves (optional), as intended by AC-1/FR-4 and AC-8, and align with build handling/趁机 per platform conventions (ongoing).

**This version represents the first ratified, stable contract for agents and boards to produce/consume structured basis data, ensuring interoperability, auditability, and cross-agent comparability.**

---

## Version History notes

- v0.x — Early drafts (not officially versioned). Resurrected experimental fragments as examples; they remain OUTSIDE the ratified v1 schema contract. Not recommended for production use.
- v1.x — Ratified schema. First endorsed artifact is v1.0.0 (2025-06-18). Future version bumps (e.g., 1.1.0) will add new fields, behaviors, or change defaults while maintaining backward compatibility (semver).
- Future versions may add: transport protocol extensions, compression, streaming slices, additional inference inference types, and elaborated discovery.