import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const sourceRoot = path.resolve('src');
const sourceFiles = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      sourceFiles.push(fullPath);
    }
  }
}

function location(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(process.cwd(), sourceFile.fileName)}:${position.line + 1}`;
}

walk(sourceRoot);

const violations = [];
for (const filePath of sourceFiles) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      violations.push(`${location(sourceFile, node)} empty catch clause`);
    }

    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'catch'
    ) {
      const callback = node.arguments[0];
      if (
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        && ts.isBlock(callback.body)
        && callback.body.statements.length === 0
      ) {
        violations.push(`${location(sourceFile, node)} empty promise catch callback`);
      }
    }

    if (
      !filePath.endsWith(path.join('application', 'observability', 'caughtErrorReporter.ts'))
      && ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === 'console'
      && (node.expression.name.text === 'error' || node.expression.name.text === 'warn')
    ) {
      for (let current = node.parent; current; current = current.parent) {
        const inCatchClause = ts.isCatchClause(current);
        const inPromiseCatch = (
          (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
          && ts.isCallExpression(current.parent)
          && ts.isPropertyAccessExpression(current.parent.expression)
          && current.parent.expression.name.text === 'catch'
        );
        if (inCatchClause || inPromiseCatch) {
          violations.push(`${location(sourceFile, node)} caught error bypasses reportCaughtError`);
          break;
        }
      }
    }

    // A Durable Object runs outside the Worker's AsyncLocalStorage context, so
    // `reportCaughtError` there resolves NO runtime and the reporter drops the
    // record after its console line — the error is logged nowhere durable. The
    // runtime override is what makes it land, and four call sites had silently
    // been missing it. Inside a DO the third argument is mandatory.
    if (
      /DO\.ts$/.test(filePath)
      && ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'reportCaughtError'
      && node.arguments.length < 3
    ) {
      violations.push(`${location(sourceFile, node)} reportCaughtError in a Durable Object without a runtime override (report is dropped)`);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (violations.length > 0) {
  console.error(`Silent catch check failed — ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(`Silent catch check passed: ${sourceFiles.length} production TypeScript files, 0 empty catches.`);
