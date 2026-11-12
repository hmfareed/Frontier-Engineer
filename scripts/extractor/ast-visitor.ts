import crypto from "node:crypto";
import type { ParserApi } from "./parser-loader.ts";
import { computeFingerprint, computeSymbolId } from "./symbol-identity.ts";
import type {
  CallExpressionRecord,
  ExportRecord,
  ExtractedSymbol,
  ImportRecord,
  ImportedSymbol,
  SourceEvidence,
  SymbolKind,
  SymbolMetadata,
} from "./types.ts";

export interface FileAstFindings {
  symbols: ExtractedSymbol[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  callExpressions: CallExpressionRecord[];
}

function extractEvidence(node: any, sourceFile: any): SourceEvidence {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  const rawText = sourceFile.text.slice(node.getStart(sourceFile), node.getEnd());
  const evidenceHash = crypto.createHash("sha256").update(rawText, "utf8").digest("hex");
  return {
    lineStart: start.line + 1,
    lineEnd: end.line + 1,
    colStart: start.character + 1,
    colEnd: end.character + 1,
    evidenceHash,
  };
}

function hasExportModifier(node: any, parser: ParserApi): boolean {
  if (!node.modifiers) return false;
  for (const mod of node.modifiers) {
    if (mod.kind === parser.SyntaxKind.ExportKeyword) return true;
  }
  return false;
}

function hasDefaultModifier(node: any, parser: ParserApi): boolean {
  if (!node.modifiers) return false;
  for (const mod of node.modifiers) {
    if (mod.kind === parser.SyntaxKind.DefaultKeyword) return true;
  }
  return false;
}

function hasJsx(node: any, parser: ParserApi): boolean {
  let found = false;
  function walk(n: any) {
    if (found || !n) return;
    if (
      n.kind === parser.SyntaxKind.JsxElement ||
      n.kind === parser.SyntaxKind.JsxSelfClosingElement ||
      n.kind === parser.SyntaxKind.JsxFragment
    ) {
      found = true;
      return;
    }
    parser.forEachChild(n, walk);
  }
  walk(node);
  return found;
}

function isPascalCase(str: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(str);
}

function hasReactTypeAnnotation(typeNode: any, sourceFile: any): boolean {
  if (!typeNode) return false;
  const typeText = sourceFile.text.slice(typeNode.getStart(sourceFile), typeNode.getEnd());
  return /^(React\.)?(FC|FunctionComponent)\b/.test(typeText);
}

/**
 * Traverses a parsed TypeScript SourceFile AST and extracts symbols, imports,
 * exports, and call expressions according to Frontier AST classification rules.
 */
export function visitSourceFile(
  sourceFile: any,
  canonicalPath: string,
  parser: ParserApi,
): FileAstFindings {
  const symbols: ExtractedSymbol[] = [];
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];
  const callExpressions: CallExpressionRecord[] = [];

  const nameCounts = new Map<string, number>();
  const overloadCounts = new Map<string, number>();

  function getDisambiguator(scope: string | null, name: string): number {
    const key = `${scope || ""}::${name}`;
    const count = nameCounts.get(key) || 0;
    nameCounts.set(key, count + 1);
    return count;
  }

  function addSymbol(
    name: string,
    parentScope: string | null,
    kind: SymbolKind,
    node: any,
    isExported: boolean,
    metadata?: SymbolMetadata,
    explicitDisambiguator?: string | number,
  ): void {
    const disambiguator =
      explicitDisambiguator !== undefined
        ? explicitDisambiguator
        : getDisambiguator(parentScope, name);
    const symbolId = computeSymbolId(canonicalPath, parentScope, kind, name, disambiguator);
    const fingerprint = computeFingerprint(node, sourceFile, parser);
    const sourceEvidence = extractEvidence(node, sourceFile);

    symbols.push({
      symbolId,
      name,
      parentScope,
      kind,
      fingerprint,
      isExported,
      sourceEvidence,
      metadata,
    });
  }

  function visit(node: any, currentScope: string | null): void {
    if (!node) return;

    // 1. FunctionDeclaration
    if (node.kind === parser.SyntaxKind.FunctionDeclaration) {
      const isDefault = hasDefaultModifier(node, parser);
      const isExported = hasExportModifier(node, parser);
      const name = node.name?.text || (isDefault ? "default" : undefined);

      if (name) {
        const containsJsx = node.body ? hasJsx(node.body, parser) : false;
        const isComponent = isPascalCase(name) && containsJsx;

        const metadata: SymbolMetadata = {
          inferredCallable: true,
        };

        if (isComponent) {
          metadata.isReactComponent = true;
          metadata.reactComponentConfidence = 0.8;
          metadata.evidenceClassification = "heuristic_jsx_return";
        }

        const scopeKey = `${currentScope || ""}::function::${name}`;
        let explicitDis: string | number | undefined;

        if (node.body === undefined) {
          // Overload signature
          const count = (overloadCounts.get(scopeKey) || 0) + 1;
          overloadCounts.set(scopeKey, count);
          explicitDis = `overload:${count}`;
        } else if (overloadCounts.has(scopeKey)) {
          // Implementation of overloaded function
          explicitDis = "impl";
        }

        addSymbol(name, currentScope, "function", node, isExported, metadata, explicitDis);

        // Recurse into function body with nested scope
        if (node.body) {
          const nextScope = currentScope ? `${currentScope}.${name}` : name;
          parser.forEachChild(node.body, (child: any) => visit(child, nextScope));
          return;
        }
      }
    }

    // 2. ClassDeclaration
    else if (node.kind === parser.SyntaxKind.ClassDeclaration) {
      const isDefault = hasDefaultModifier(node, parser);
      const isExported = hasExportModifier(node, parser);
      const className = node.name?.text || (isDefault ? "default" : undefined);

      if (className) {
        addSymbol(className, currentScope, "class", node, isExported);
        const classScope = currentScope ? `${currentScope}.${className}` : className;

        // Visit class members with classScope as parent scope
        if (node.members) {
          for (const member of node.members) {
            // Method
            if (member.kind === parser.SyntaxKind.MethodDeclaration) {
              const methodName = member.name?.text;
              if (methodName) {
                const methodScopeKey = `${classScope}::method::${methodName}`;
                let explicitDis: string | number | undefined;
                if (member.body === undefined) {
                  const count = (overloadCounts.get(methodScopeKey) || 0) + 1;
                  overloadCounts.set(methodScopeKey, count);
                  explicitDis = `overload:${count}`;
                } else if (overloadCounts.has(methodScopeKey)) {
                  explicitDis = "impl";
                }

                addSymbol(
                  methodName,
                  classScope,
                  "method",
                  member,
                  false,
                  { inferredCallable: true },
                  explicitDis,
                );

                if (member.body) {
                  const methodScope = `${classScope}.${methodName}`;
                  parser.forEachChild(member.body, (child: any) => visit(child, methodScope));
                }
              }
            }
            // Get Accessor
            else if (member.kind === parser.SyntaxKind.GetAccessor) {
              const propName = member.name?.text;
              if (propName) {
                addSymbol(
                  propName,
                  classScope,
                  "method",
                  member,
                  false,
                  { inferredCallable: true },
                  "get",
                );
              }
            }
            // Set Accessor
            else if (member.kind === parser.SyntaxKind.SetAccessor) {
              const propName = member.name?.text;
              if (propName) {
                addSymbol(
                  propName,
                  classScope,
                  "method",
                  member,
                  false,
                  { inferredCallable: true },
                  "set",
                );
              }
            }
            // Constructor
            else if (member.kind === parser.SyntaxKind.Constructor) {
              addSymbol(
                "constructor",
                classScope,
                "method",
                member,
                false,
                { inferredCallable: true },
                0,
              );
              if (member.body) {
                const ctorScope = `${classScope}.constructor`;
                parser.forEachChild(member.body, (child: any) => visit(child, ctorScope));
              }
            }
          }
        }
        return;
      }
    }

    // 3. InterfaceDeclaration
    else if (node.kind === parser.SyntaxKind.InterfaceDeclaration) {
      const name = node.name?.text;
      if (name) {
        const isExported = hasExportModifier(node, parser);
        addSymbol(name, currentScope, "interface", node, isExported);
      }
    }

    // 4. TypeAliasDeclaration
    else if (node.kind === parser.SyntaxKind.TypeAliasDeclaration) {
      const name = node.name?.text;
      if (name) {
        const isExported = hasExportModifier(node, parser);
        addSymbol(name, currentScope, "type_alias", node, isExported);
      }
    }

    // 5. EnumDeclaration
    else if (node.kind === parser.SyntaxKind.EnumDeclaration) {
      const name = node.name?.text;
      if (name) {
        const isExported = hasExportModifier(node, parser);
        addSymbol(name, currentScope, "enum", node, isExported);
      }
    }

    // 6. VariableStatement
    else if (node.kind === parser.SyntaxKind.VariableStatement) {
      const isExported = hasExportModifier(node, parser);
      if (node.declarationList?.declarations) {
        for (const decl of node.declarationList.declarations) {
          const varName = decl.name?.text;
          if (varName) {
            const init = decl.initializer;
            const isArrowOrFn =
              init &&
              (init.kind === parser.SyntaxKind.ArrowFunction ||
                init.kind === parser.SyntaxKind.FunctionExpression);

            const hasExplicitReactType = hasReactTypeAnnotation(decl.type, sourceFile);
            const containsJsx = init ? hasJsx(init, parser) : false;
            const isComponent = isPascalCase(varName) && (hasExplicitReactType || containsJsx);

            const metadata: SymbolMetadata = {
              inferredCallable: Boolean(isArrowOrFn),
            };

            if (isComponent) {
              metadata.isReactComponent = true;
              metadata.reactComponentConfidence = hasExplicitReactType ? 1.0 : 0.8;
              metadata.evidenceClassification = hasExplicitReactType
                ? "syntactic_ast"
                : "heuristic_jsx_return";
            }

            addSymbol(varName, currentScope, "variable", decl, isExported, metadata);

            if (isArrowOrFn && init.body) {
              const arrowScope = currentScope ? `${currentScope}.${varName}` : varName;
              parser.forEachChild(init.body, (child: any) => visit(child, arrowScope));
            }
          }
        }
      }
    }

    // 7. ImportDeclaration
    else if (node.kind === parser.SyntaxKind.ImportDeclaration) {
      const specifier = node.moduleSpecifier?.text;
      if (specifier) {
        const isTypeOnly = Boolean(node.importClause?.isTypeOnly);
        const importedSymbols: ImportedSymbol[] = [];
        let isWildcard = false;

        if (node.importClause) {
          // Default import
          if (node.importClause.name) {
            importedSymbols.push({
              name: "default",
              alias: node.importClause.name.text,
            });
          }

          // Named or namespace bindings
          const bindings = node.importClause.namedBindings;
          if (bindings) {
            if (bindings.kind === parser.SyntaxKind.NamespaceImport) {
              isWildcard = true;
            } else if (bindings.kind === parser.SyntaxKind.NamedImports && bindings.elements) {
              for (const el of bindings.elements) {
                const name = el.propertyName?.text || el.name.text;
                const alias = el.propertyName ? el.name.text : undefined;
                importedSymbols.push({
                  name,
                  alias,
                  isTypeOnly: Boolean(el.isTypeOnly || isTypeOnly),
                });
              }
            }
          }
        }

        imports.push({
          specifier,
          resolvedPath: null,
          importedSymbols: isWildcard ? "*" : importedSymbols,
          isTypeOnly,
          isDynamic: false,
          evidenceClassification: "syntactic_ast",
          sourceEvidence: extractEvidence(node, sourceFile),
        });
      }
    }

    // 8. ExportDeclaration
    else if (node.kind === parser.SyntaxKind.ExportDeclaration) {
      const sourceModule = node.moduleSpecifier?.text || null;
      const isReExport = Boolean(sourceModule);
      const isTypeOnly = Boolean(node.isTypeOnly);

      if (!node.exportClause) {
        exports.push({
          name: "*",
          localName: "*",
          isReExport,
          sourceModule,
          isTypeOnly,
          isWildcard: true,
          sourceEvidence: extractEvidence(node, sourceFile),
        });
      } else if (
        node.exportClause.kind === parser.SyntaxKind.NamedExports &&
        node.exportClause.elements
      ) {
        for (const el of node.exportClause.elements) {
          const name = el.name.text;
          const localName = el.propertyName?.text || el.name.text;
          exports.push({
            name,
            localName,
            isReExport,
            sourceModule,
            isTypeOnly: Boolean(el.isTypeOnly || isTypeOnly),
            isWildcard: false,
            sourceEvidence: extractEvidence(el, sourceFile),
          });
        }
      }
    }

    // 9. CallExpression (Dynamic import detection)
    else if (node.kind === parser.SyntaxKind.CallExpression) {
      if (node.expression?.kind === parser.SyntaxKind.ImportKeyword) {
        const arg0 = node.arguments?.[0];
        if (arg0 && (arg0.text || arg0.kind === parser.SyntaxKind.StringLiteral)) {
          const specifier = arg0.text || "";
          imports.push({
            specifier,
            resolvedPath: null,
            importedSymbols: "*",
            isTypeOnly: false,
            isDynamic: true,
            evidenceClassification: "dynamic_import_inferred",
            sourceEvidence: extractEvidence(node, sourceFile),
          });
        }
      }

      const calleeName =
        node.expression?.text ||
        node.expression?.name?.text ||
        (node.expression?.kind === parser.SyntaxKind.ImportKeyword ? "import" : "");

      if (calleeName) {
        callExpressions.push({
          calleeName,
          sourceEvidence: extractEvidence(node, sourceFile),
          isDynamicImport: node.expression?.kind === parser.SyntaxKind.ImportKeyword,
        });
      }
    }

    // Recurse into children
    parser.forEachChild(node, (child: any) => visit(child, currentScope));
  }

  // Visit top-level statements
  parser.forEachChild(sourceFile, (child: any) => visit(child, null));

  return { symbols, imports, exports, callExpressions };
}
