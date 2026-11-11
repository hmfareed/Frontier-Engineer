import ts from "typescript";

export const createSourceFile = ts.createSourceFile;
export const forEachChild = ts.forEachChild;
export const SyntaxKind = ts.SyntaxKind;
export const ScriptTarget = ts.ScriptTarget;
export const ScriptKind = ts.ScriptKind;

export default {
  createSourceFile: ts.createSourceFile,
  forEachChild: ts.forEachChild,
  SyntaxKind: ts.SyntaxKind,
  ScriptTarget: ts.ScriptTarget,
  ScriptKind: ts.ScriptKind,
};
