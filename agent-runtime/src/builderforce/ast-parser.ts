/**
 * AST parsing utilities for TypeScript/JavaScript files
 */

import fs from "node:fs/promises";
import ts from "typescript";
import type {
  FileInfo,
  FunctionInfo,
  ClassInfo,
  InterfaceInfo,
  TypeInfo,
  MethodInfo,
  PropertyInfo,
} from "./types.js";

/**
 * Parse a TypeScript file and extract semantic information
 */
export async function parseTypeScriptFile(filePath: string): Promise<FileInfo> {
  const content = await fs.readFile(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  const functions: FunctionInfo[] = [];
  const classes: ClassInfo[] = [];
  const interfaces: InterfaceInfo[] = [];
  const types: TypeInfo[] = [];

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const func: FunctionInfo = {
        name: node.name.text,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        params: node.parameters.map((p) => (p.name as ts.Identifier).text || ""),
        returnType: node.type?.getText(sourceFile),
        exported: hasExportModifier(node),
        async: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
      };
      functions.push(func);
    } else if (ts.isClassDeclaration(node) && node.name) {
      const cls: ClassInfo = {
        name: node.name.text,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        extends: node.heritageClauses
          ?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)
          ?.types[0]?.expression.getText(sourceFile),
        implements:
          node.heritageClauses
            ?.find((c) => c.token === ts.SyntaxKind.ImplementsKeyword)
            ?.types.map((t) => t.expression.getText(sourceFile)) || [],
        methods: extractMethods(node, sourceFile),
        exported: hasExportModifier(node),
      };
      classes.push(cls);
    } else if (ts.isInterfaceDeclaration(node)) {
      const iface: InterfaceInfo = {
        name: node.name.text,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        extends:
          node.heritageClauses
            ?.flatMap((c) => c.types.map((t) => t.expression.getText(sourceFile)))
            .filter(Boolean) || [],
        properties: extractProperties(node, sourceFile),
        methods: extractInterfaceMethods(node, sourceFile),
        exported: hasExportModifier(node),
      };
      interfaces.push(iface);
    } else if (ts.isTypeAliasDeclaration(node)) {
      const typeInfo: TypeInfo = {
        name: node.name.text,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        definition: node.type.getText(sourceFile),
        exported: hasExportModifier(node),
      };
      types.push(typeInfo);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const stats = await fs.stat(filePath);
  return {
    path: filePath,
    language: "typescript",
    size: stats.size,
    lastModified: stats.mtime,
    functions,
    classes,
    interfaces,
    types,
  };
}

function hasExportModifier(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node);
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false;
  }
  return false;
}

function extractMethods(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): MethodInfo[] {
  const methods: MethodInfo[] = [];

  for (const member of node.members) {
    if (ts.isMethodDeclaration(member) && member.name) {
      const name = member.name.getText(sourceFile);
      const method: MethodInfo = {
        name,
        line: sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1,
        params: member.parameters.map((p) => (p.name as ts.Identifier).text || ""),
        returnType: member.type?.getText(sourceFile),
        visibility: getVisibility(member),
        static: member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) || false,
        async: member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
      };
      methods.push(method);
    }
  }

  return methods;
}

function extractProperties(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
): PropertyInfo[] {
  const properties: PropertyInfo[] = [];

  for (const member of node.members) {
    if (ts.isPropertySignature(member) && member.name) {
      const name = member.name.getText(sourceFile);
      const property: PropertyInfo = {
        name,
        type: member.type?.getText(sourceFile),
        optional: member.questionToken !== undefined,
        readonly: member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) || false,
      };
      properties.push(property);
    }
  }

  return properties;
}

function extractInterfaceMethods(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
): MethodInfo[] {
  const methods: MethodInfo[] = [];

  for (const member of node.members) {
    if (ts.isMethodSignature(member) && member.name) {
      const name = member.name.getText(sourceFile);
      const method: MethodInfo = {
        name,
        line: sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1,
        params: member.parameters.map((p) => (p.name as ts.Identifier).text || ""),
        returnType: member.type?.getText(sourceFile),
        visibility: "public",
        static: false,
        async: false,
      };
      methods.push(method);
    }
  }

  return methods;
}

function getVisibility(node: ts.MethodDeclaration): "public" | "private" | "protected" {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) {
    return "private";
  }
  if (modifiers?.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) {
    return "protected";
  }
  return "public";
}

/**
 * Extract imports and exports from a TypeScript file
 */
export async function extractImportsAndExports(filePath: string): Promise<{
  imports: Array<{ source: string; imports: string[] }>;
  exports: Array<{ name: string; kind: string }>;
}> {
  const content = await fs.readFile(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  const imports: Array<{ source: string; imports: string[] }> = [];
  const exports: Array<{ name: string; kind: string }> = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const source = (node.moduleSpecifier as ts.StringLiteral).text;
      const importNames: string[] = [];

      if (node.importClause) {
        if (node.importClause.name) {
          importNames.push(node.importClause.name.text);
        }
        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const element of node.importClause.namedBindings.elements) {
              importNames.push(element.name.text);
            }
          } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            importNames.push(node.importClause.namedBindings.name.text);
          }
        }
      }

      imports.push({ source, imports: importNames });
    } else if (hasExportModifier(node)) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        exports.push({ name: node.name.text, kind: "function" });
      } else if (ts.isClassDeclaration(node) && node.name) {
        exports.push({ name: node.name.text, kind: "class" });
      } else if (ts.isInterfaceDeclaration(node)) {
        exports.push({ name: node.name.text, kind: "interface" });
      } else if (ts.isTypeAliasDeclaration(node)) {
        exports.push({ name: node.name.text, kind: "type" });
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            const kind = node.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
            exports.push({ name: declaration.name.text, kind });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return { imports, exports };
}
