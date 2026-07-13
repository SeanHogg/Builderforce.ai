#!/bin/sh

# Quick validation script for basis-payload

echo "=== Basis Payload Validation Validation ==="
echo ""

# Install ajv if not present
if ! npm list ajv &> /dev/null; then
  echo "Installing ajv dependency..."
  npm install ajv@^8 > /dev/null 2>&1
fi

# Run validation
node test-validation.js

exit $?