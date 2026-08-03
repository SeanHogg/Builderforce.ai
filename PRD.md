> **PRD** — drafted by Bob Developer (V2 (Container)) · task #1598
> _Each agent that updates this PRD signs its change below._

# Dependency PR #416: chore(deps): bump @opentelemetry/sdk-node from 0.212.0 to 0.217.0 in /agent-runtime

## 1. Problem & Goal

### Problem
The current version of `@opentelemetry/sdk-node` (0.212.0) in the `/agent-runtime` directory is outdated. Upgrading to the latest version (0.217.0) is necessary to incorporate new features, bug fixes, and security patches.

### Goal
- Update `@opentelemetry/sdk-node` from 0.212.0 to 0.217.0.
- Ensure compatibility and stability of the agent runtime after the upgrade.
- Address any potential security vulnerabilities introduced in older versions.

## 2. Target Users / ICP Roles

- **Software Developers**: Responsible for maintaining and updating the agent runtime.
- **DevOps Engineers**: Ensure the updated dependency does not disrupt the CI/CD pipeline.
- **Security Analysts**: Verify that the upgrade does not introduce new security vulnerabilities.

## 3. Scope

- Update the `@opentelemetry/sdk-node` dependency in the `/agent-runtime` directory from version 0.212.0 to 0.217.0.
- Review and incorporate the following changes from the release notes:
  - **Features**:
    - Replace protobufjs trace serialization with a custom implementation.
    - Auto-generate TypeScript types from OTel declarative config JSON schema.
    - Update `startNodeSDK()` to use `log_level` configuration for DiagConsoleLogger setup.
  - **Bug Fixes**:
    - Fix validation of `OTEL_CONFIG_FILE` value.
    - Improve handling of additional properties in JSON schema.
    - Remove stripMinItems and preprocessNullArrays from validation/parsing.
    - Enhance handling of enums in generated types.
    - Improve the technique for removing '| null' on types in JSON Schema.
    - Add missing axios dependency for sampler-jaeger-remote.
    - Handle malformed URLs in Prometheus exporter request handler.

## 4. Functional Requirements

- **Dependency Update**:
  - Update the `@opentelemetry/sdk-node` dependency in `package.json` to version 0.217.0.
  - Update `yarn.lock` or `package-lock.json` accordingly.

- **Compatibility Check**:
  - Ensure that the agent runtime builds successfully after the update.
  - Verify that all unit and integration tests pass.
  - Check for any deprecation warnings or breaking changes in the updated dependency.

- **Security Review**:
  - Conduct a security audit to identify any new vulnerabilities introduced by the update.
  - Ensure that the updated dependency does not expose any new attack vectors.

- **Documentation**:
  - Update any relevant documentation to reflect the changes in the dependency version.
  - Include notes on new features and bug fixes introduced in the updated version.

## 5. Acceptance Criteria

- The `@opentelemetry/sdk-node` dependency in `/agent-runtime` is updated to version 0.217.0.
- The agent runtime builds successfully without errors.
- All unit and integration tests pass.
- No deprecation warnings or breaking changes are present.
- The security audit confirms that the update does not introduce new vulnerabilities.
- Documentation is updated to reflect the changes and includes notes on new features and bug fixes.

## 6. Out of Scope

- Updating other dependencies in the project that are not directly related to the `@opentelemetry/sdk-node` update.
- Refactoring the agent runtime codebase to incorporate new features from the updated dependency, unless required for compatibility.
- Addressing any issues unrelated to the dependency update that are discovered during the review process.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._

## Acceptance

_Owned by the validator — to be authored._