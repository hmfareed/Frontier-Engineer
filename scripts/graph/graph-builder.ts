/**
 * Phase 7.3 — Engineering Graph Builder
 * Deterministic generation of graph nodes and provenance-backed edges from inventory and extractions.
 */

import path from "node:path";
import type { ScannedFileRecord } from "../scanner/types.ts";
import type { ExtractionResult } from "../extractor/types.ts";
import type { GraphNode, GraphEdge } from "./types.ts";

export interface BuildGraphInput {
  repositoryIdentity: string;
  files: ScannedFileRecord[];
  extractions: Map<string, ExtractionResult>;
  pathToId?: Map<string, number>;
}

export class GraphBuilder {
  public static buildGraph(input: BuildGraphInput): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } {
    const nodesMap = new Map<string, GraphNode>();
    const edgesMap = new Map<string, GraphEdge>();
    const now = new Date().toISOString();

    // 1. Root Repository Node
    const repoNodeId = `repo:${input.repositoryIdentity}`;
    nodesMap.set(repoNodeId, {
      nodeIdentity: repoNodeId,
      category: "repository",
      name: input.repositoryIdentity,
    });

    const directories = new Set<string>();

    // 2. Discover Directories and File Nodes
    for (const file of input.files) {
      const canonicalPath = file.canonicalPath;
      const isTest =
        canonicalPath.includes(".test.") ||
        canonicalPath.includes(".spec.") ||
        canonicalPath.startsWith("tests/") ||
        canonicalPath.startsWith("test/");

      const category = isTest ? "test" : "file";
      const fileNodeId = `file:${canonicalPath}`;

      nodesMap.set(fileNodeId, {
        nodeIdentity: fileNodeId,
        category,
        name: path.basename(canonicalPath),
        metadata: {
          canonicalPath,
          classification: file.classification,
          sizeBytes: file.sizeBytes,
        },
      });

      // Track all parent directory hierarchies
      let currentDir = path.posix.dirname(canonicalPath);
      while (currentDir && currentDir !== "." && currentDir !== "/") {
        directories.add(currentDir);
        currentDir = path.posix.dirname(currentDir);
      }
    }

    // 3. Create Directory Nodes and Hierarchy
    for (const dir of Array.from(directories).sort()) {
      const dirNodeId = `dir:${dir}`;
      if (!nodesMap.has(dirNodeId)) {
        nodesMap.set(dirNodeId, {
          nodeIdentity: dirNodeId,
          category: "directory",
          name: path.posix.basename(dir),
          metadata: { path: dir },
        });
      }

      const parentDir = path.posix.dirname(dir);
      const parentNodeId = parentDir === "." || parentDir === "/" ? repoNodeId : `dir:${parentDir}`;

      const edgeId = `${parentNodeId}->CONTAINS->${dirNodeId}`;
      edgesMap.set(edgeId, {
        edgeIdentity: edgeId,
        sourceNodeIdentity: parentNodeId,
        targetNodeIdentity: dirNodeId,
        relationshipType: "CONTAINS",
        confidence: 1.0,
        relationshipStatus: "CONFIRMED",
        createdAt: now,
      });
    }

    // 4. Connect Directories to Files (or Repo to Root Files)
    for (const file of input.files) {
      const canonicalPath = file.canonicalPath;
      const fileNodeId = `file:${canonicalPath}`;
      const parentDir = path.posix.dirname(canonicalPath);
      const parentNodeId = parentDir === "." || parentDir === "/" ? repoNodeId : `dir:${parentDir}`;

      const edgeId = `${parentNodeId}->CONTAINS->${fileNodeId}`;
      edgesMap.set(edgeId, {
        edgeIdentity: edgeId,
        sourceNodeIdentity: parentNodeId,
        targetNodeIdentity: fileNodeId,
        relationshipType: "CONTAINS",
        confidence: 1.0,
        relationshipStatus: "CONFIRMED",
        createdAt: now,
      });
    }

    // 5. Symbols, Imports, Exports & Test Associations from Extractions
    for (const [filePath, extraction] of input.extractions.entries()) {
      const fileNodeId = `file:${filePath}`;

      // A. Symbols
      for (const sym of extraction.symbols) {
        const symNodeId = `sym:${sym.symbolId}`;
        nodesMap.set(symNodeId, {
          nodeIdentity: symNodeId,
          category: "symbol",
          name: sym.name,
          metadata: {
            kind: sym.kind,
            fingerprint: sym.fingerprint,
            isExported: sym.isExported,
            lineStart: sym.sourceEvidence.lineStart,
            lineEnd: sym.sourceEvidence.lineEnd,
          },
        });

        // File DEFINES Symbol
        const defEdgeId = `${fileNodeId}->DEFINES->${symNodeId}`;
        edgesMap.set(defEdgeId, {
          edgeIdentity: defEdgeId,
          sourceNodeIdentity: fileNodeId,
          targetNodeIdentity: symNodeId,
          relationshipType: "DEFINES",
          confidence: 1.0,
          relationshipStatus: "CONFIRMED",
          createdAt: now,
        });

        if (sym.isExported) {
          const expEdgeId = `${fileNodeId}->EXPORTS->${symNodeId}`;
          edgesMap.set(expEdgeId, {
            edgeIdentity: expEdgeId,
            sourceNodeIdentity: fileNodeId,
            targetNodeIdentity: symNodeId,
            relationshipType: "EXPORTS",
            confidence: 1.0,
            relationshipStatus: "CONFIRMED",
            createdAt: now,
          });
        }
      }

      // B. Imports
      for (const imp of extraction.imports) {
        if (imp.resolvedPath) {
          const targetFileNodeId = `file:${imp.resolvedPath}`;
          const importEdgeId = `${fileNodeId}->IMPORTS->${targetFileNodeId}`;

          const declInfo = {
            lineStart: imp.sourceEvidence?.lineStart ?? 1,
            lineEnd: imp.sourceEvidence?.lineEnd ?? 1,
            importedSymbols: imp.importedSymbols,
            isTypeOnly: imp.isTypeOnly,
            isDynamic: imp.isDynamic,
          };

          const existingEdge = edgesMap.get(importEdgeId);
          if (existingEdge) {
            const meta = existingEdge.metadata ?? { declarationCount: 1, declarations: [] };
            meta.declarationCount = ((meta.declarationCount as number) || 1) + 1;
            (meta.declarations as any[]).push(declInfo);
            existingEdge.metadata = meta;
          } else {
            edgesMap.set(importEdgeId, {
              edgeIdentity: importEdgeId,
              sourceNodeIdentity: fileNodeId,
              targetNodeIdentity: targetFileNodeId,
              relationshipType: "IMPORTS",
              confidence: 1.0,
              relationshipStatus: "CONFIRMED",
              createdAt: now,
              metadata: {
                declarationCount: 1,
                declarations: [declInfo],
              },
            });
          }

          // Also test association: if this file is a test file, it TESTS target
          if (
            filePath.includes(".test.") ||
            filePath.includes(".spec.") ||
            filePath.startsWith("tests/") ||
            filePath.startsWith("test/")
          ) {
            const testEdgeId = `${fileNodeId}->TESTS->${targetFileNodeId}`;
            edgesMap.set(testEdgeId, {
              edgeIdentity: testEdgeId,
              sourceNodeIdentity: fileNodeId,
              targetNodeIdentity: targetFileNodeId,
              relationshipType: "TESTS",
              confidence: 1.0,
              relationshipStatus: "CONFIRMED",
              createdAt: now,
            });
          }
        } else {
          // Unresolved or External
          const isExternal =
            !imp.specifier.startsWith(".") &&
            !imp.specifier.startsWith("/") &&
            !imp.specifier.startsWith("@/") &&
            !imp.specifier.startsWith("~");

          if (isExternal) {
            const pkgNodeId = `pkg:${imp.specifier}`;
            if (!nodesMap.has(pkgNodeId)) {
              nodesMap.set(pkgNodeId, {
                nodeIdentity: pkgNodeId,
                category: "package",
                name: imp.specifier,
              });
            }
            const depEdgeId = `${fileNodeId}->DEPENDS_ON->${pkgNodeId}`;
            edgesMap.set(depEdgeId, {
              edgeIdentity: depEdgeId,
              sourceNodeIdentity: fileNodeId,
              targetNodeIdentity: pkgNodeId,
              relationshipType: "DEPENDS_ON",
              confidence: 0.9,
              relationshipStatus: "CONFIRMED",
              createdAt: now,
            });
          } else {
            // Unresolved module
            const modNodeId = `mod:${imp.specifier}`;
            if (!nodesMap.has(modNodeId)) {
              nodesMap.set(modNodeId, {
                nodeIdentity: modNodeId,
                category: "module",
                name: imp.specifier,
              });
            }
            const unresEdgeId = `${fileNodeId}->IMPORTS->${modNodeId}`;
            edgesMap.set(unresEdgeId, {
              edgeIdentity: unresEdgeId,
              sourceNodeIdentity: fileNodeId,
              targetNodeIdentity: modNodeId,
              relationshipType: "IMPORTS",
              confidence: 0.5,
              relationshipStatus: "UNRESOLVED",
              createdAt: now,
            });
          }
        }
      }
    }

    return {
      nodes: Array.from(nodesMap.values()),
      edges: Array.from(edgesMap.values()),
    };
  }
}
