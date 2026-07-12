# QA Tests for Builderforce AI

This directory contains automated QA tests for validating cloud agent telemetry and billing accuracy.

## Test Coverage

### GAP-O1: Telemetry Reconstruction Tests
Location: `telemetry-reconstruction.test.ts`

Validates that cloud agent telemetry data can be accurately reconstructed from raw events, handling edge cases:

- **Normal Operation**: Simple event sequences, start/end time identification
- **Out-of-Order Events**: Timeline reconstruction with sorted timestamps
- **Missing/Partial Data**: Graceful handling of missing events and timestamps
- **Edge Cases**: Empty lists, single events, duplicate IDs, invalid timestamps
- **Timestamp Validation**: Negative timestamp rejection, undefined timestamp handling
- **End-to-End**: Execution metadata, metadata preservation

### GAP-O2: Billing Ledger Consistency Tests
Location: `billing-ledger-consistency.test.ts`

Validates that cloud agent billing ledger accurately reflects agent activity:

- **Normal Operation**: Consistent activities and ledger entries
- **Conistency Checks**: Missing entries, extraneous entries, total credit mismatches
- **Scaling Tests**: Multiple agents, large transaction volumes
- **Edge Cases**: Empty lists, zero credits, partial ledger entries
- **Metadata Accuracy**: Activity metadata preservation, derived cost calculations, rate verification
- **Entry Types**: Execution, tool usage, LLM inference verification
- **Integration**: Complete workflow validation, manual audit detection, post-execution validation

## Test Infrastructure

### Mock Data Generators
Location: `test-harness/mock-data-generators.ts`

Provides utilities for generating synthetic test data:

- `generateMockTelemetryEvents()`: Creates realistic telemetry event sequences
- `generateMockBillableActivities()`: Generates billable activity records
- `generateMockBillableLedger()`: Creates ledger entries from activities
- `generatePartialMockTelemetryEvents()`: Simulates data loss scenarios
- `generateIncompleteTimestampEvents()`: Creates events with missing/incomplete timestamps
- `createEdgeCaseScenarios()`: Provides edge case test data

## Running Tests

### Local Execution

```bash
# Install dependencies
npm install

# Run all QA tests
npm test -- qa-tests/

# Run specific test file
npm test -- telemetry-reconstruction.test.ts

# Run with coverage
npm test -- --coverage -- qa-tests/

# Run specific test suite
npm test -- -t "GAP-O1"
npm test -- -t "GAP-O2"
```

### CI/CD Pipeline

Tests run automatically in the CI pipeline on:
- Pull requests targeting `main`/`master`
- Scheduled nightly runs
- Manual triggers

```bash
# View test results on GitHub Actions
# https://github.com/seanhogg/builderforce.ai/actions/workflows/
```

## Test Configuration

Tests use Jest as the test runner. Configuration is located in:

- `jest.config.js` - Jest configuration
- `.github/workflows/ci.yml` - CI pipeline integration

## Fixtures

Existing existing test bugs in agent-runtime: Swabble tests in Swabble/Tests/ directory; not related to this PRD-driven test directory.

## Contributing

To add new tests:

1. Add test data generators to `test-harness/mock-data-generators.ts` if needed
2. Write tests following the existing patterns in `*.test.ts` files
3. Ensure tests are descriptive with clear it() blocks
4. Include edge case coverage as per PRD requirements
5. Run tests locally before committing

## Debugging

### View Test Output

```bash
# Verbose output
npm test -- --verbose qa-tests/

# Noisy output with detailed logs
npm run jest -- --no-coverage qa-tests/

# Record test results for specific run
npm test -- --testNamePattern="specific test name"
```

### Common Issues

1. **Test Timeout**: If tests take too long, consider using `beforeAll` caching for expensive setup
2. **Mock Data Issues**: Check mock data generators for parameter ranges
3. **CI Failures**: Verify workflow permissions and timeout settings

## Success Criteria

Tests validate:

- ✓ Telemetry reconstruction accuracy for GAP-O1
- ✓ Billing ledger consistency for GAP-O2
- ✓ Edge case handling (partial data, out-of-order events)
- ✓ Actionable error messages on failures
- ✓ Integration with CI/CD pipeline
- ✓ Dashboard visibility of results

## References

- PRD: Telemetry Reconstruction Tests (task #485)
- GAP-O1: Telemetry Reconstruction validation
- GAP-O2: Billing Ledger Consistency validation