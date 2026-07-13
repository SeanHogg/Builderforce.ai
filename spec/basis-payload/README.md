# Basis Payload Specification

This directory contains the canonical specification for the **Basis Payload** JSON structure that agents and boards use to exchange structured reasoning, evidence, and confidence data.

## Quick Start

- **Overview:** [basis-payload.md](./basis-payload.md) — Full specification document with all fields, constraints, and examples
- **Schema:** [basis-payload.schema.json](./basis-payload.schema.json) — JSON Schema (Draft 2020-12) for programmatic validation
- **Example:** [example.canonical.json](./example.canonical.json) — Complete, validated sample payload
- **Development:** [validate.js](./validate.js) — Command-line utility to validate basises

## Versioning

Current schema version: **1.0.0**

To update the schema:
1. Increment version in all files (`basis-payload.md`, `basis-payload.schema.json`, `example.canonical.json`, `CHANGELOG.md`)
2. Update the specification document with breaking changes
3. Update the JSON Schema artifact with validation rules
4. Update the canonical example payload
5. Document the changes in `CHANGELOG.md`

## Structure

```
spec/basis-payload/
├── README.md                    # This file
├── basis-payload.md             # Specification documentation
├── basis-payload.schema.json    # JSON Schema validation artifact
├── example.canonical.json       # Valid canonical example
├── CHANGELOG.md                 # Version history
└── validate.js                  # Validation utility
```

## Validation

### Using the JSON Schema

```javascript
import { validate } from 'ajv';

const ajv = new validate();
const schema = require('./basis-payload.schema.json');

function validateBasis(payload) {
  const valid = ajv.validateSchema(schema);
  if (!valid) {
    throw new Error('Invalid schema: ' + ajv.errorsText());
  }

  const result = ajv.validate(schema, payload);
  return {
    valid: result,
    errors: result ? undefined : ajv.errors
  };
}
```

### Using validate.js CLI

```bash
node validate.js example.canonical.json
```

Integration points are defined in the specification under **Validation Rules** (Section 6) and **Failure Modes** (Section 7).

## Coverage

This specification covers the design and documentation of the JSON payload structure only. It does NOT cover:

- Transport protocols (REST, WebSocket, message queue)
- Storage backend design
- UI rendering implementation
- Authentication / authorization
- Payload compression or binary encoding
- Real-time streaming formats
- Automated basis generation logic

## Contributing

To suggest changes to this specification:

1. Open an issue describing the proposed change
2. If accepted, open a pull request:
   - Update `basis-payload.md` with changes (maintaining SemVer)
   - Update `basis-payload.schema.json` with schema changes
   - Update `example.canonical.json` if the example must change
   - Update `CHANGELOG.md`
3. Reference PRD task #674 in the pull request

## Related Documentation

- Full PRD: [../PRD.md](../../PRD.md) — Agent/Board Basis Payload Structure PRD
- Architectural notes: [../...omb](../...)
- Test evidence: TBD (QA test artifacts)