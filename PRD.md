> **PRD** — drafted by Bob Developer (V2 (Container)) · task #1590
> _Each agent that updates this PRD signs its change below._

# Dependency Update PR #385: chore(dev-deps): bump the types group across 6 directories with 1 update

## Problem & Goal
### Problem
The current versions of `@types/node` in multiple directories are outdated, which may lead to compatibility issues, security vulnerabilities, and missed improvements or bug fixes.

### Goal
Update the `@types/node` dependency across six directories to the latest version to ensure compatibility, improve security, and leverage the latest features and fixes.

## Target Users / ICP Roles
- **Developers**: Ensure that the development environment is up-to-date and secure.
- **Security Analysts**: Reduce the risk of vulnerabilities by keeping dependencies current.
- **DevOps Engineers**: Maintain the stability and reliability of the build and deployment pipelines.

## Scope
- Update the `@types/node` dependency in the following directories:
  - `/agent-runtime`
  - `/browser-sdk`
  - `/qa-e2e`
  - `/sdk`
  - `/studio`
  - `/voice`
- The update is from version `25.3.0` to `25.9.5` in five directories and from `24.13.2` to `24.13.3` in one directory.
- The update also includes a minor version bump from `22.20.0` to `22.20.1` in one directory.

## Functional Requirements
1. **Dependency Update**
   - Update `@types/node` to `25.9.5` in the `/agent-runtime`, `/browser-sdk`, `/qa-e2e`, `/sdk`, and `/studio` directories.
   - Update `@types/node` to `24.13.3` in the `/voice` directory.
   - Update `@types/node` to `22.20.1` in the directory where the minor version bump is required.

2. **Compatibility Checks**
   - Run automated tests to ensure that the updated types do not introduce breaking changes.
   - Verify that all TypeScript types are correctly recognized and that there are no type errors.

3. **Security Review**
   - Conduct a security assessment to ensure that the new version does not introduce new vulnerabilities.
   - Check for any reported security issues in the updated version.

4. **Documentation Update**
   - Update the `package.json` files in the respective directories with the new version numbers.
   - Update any relevant documentation to reflect the changes.

## Acceptance Criteria
- All six directories have the `@types/node` dependency updated to the specified versions.
- All automated tests pass without errors.
- No type errors are introduced in the codebase.
- Security assessment confirms that the update does not introduce new vulnerabilities.
- `package.json` files are updated with the new version numbers.
- Relevant documentation is updated to reflect the changes.

## Out of Scope
- Updating other dependencies that are not `@types/node`.
- Refactoring code to accommodate changes in the updated types.
- Updating the TypeScript version or other development dependencies.
- Addressing any issues that are not directly related to the `@types/node` update.

## Additional Notes
- The update to version `25.9.5` is the latest stable release at the time of this PR.
- The update to version `24.13.3` and `22.20.1` is a minor version bump and should not introduce significant changes.
- If any issues arise during the update process, they should be documented and addressed before merging the PR.

## Links
- [GitHub PR #385](https://github.com/SeanHogg/Builderforce.ai/pull/385)
- [Compare View for @types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/commits/HEAD/types/node)

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