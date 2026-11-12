import ts from "typescript";

export const isBundledParser = true;
export const createSourceFile = ts.createSourceFile;
export const forEachChild = ts.forEachChild;
export const SyntaxKind = ts.SyntaxKind;
export const ScriptTarget = ts.ScriptTarget;
export const ScriptKind = ts.ScriptKind;
export const resolveModuleName = ts.resolveModuleName;
export const ModuleResolutionKind = ts.ModuleResolutionKind;
export const parseJsonConfigFileContent = ts.parseJsonConfigFileContent;
export const readConfigFile = ts.readConfigFile;
export const sys = ts.sys;

export default {
  isBundledParser: true,
  createSourceFile: ts.createSourceFile,
  forEachChild: ts.forEachChild,
  SyntaxKind: ts.SyntaxKind,
  ScriptTarget: ts.ScriptTarget,
  ScriptKind: ts.ScriptKind,
  resolveModuleName: ts.resolveModuleName,
  ModuleResolutionKind: ts.ModuleResolutionKind,
  parseJsonConfigFileContent: ts.parseJsonConfigFileContent,
  readConfigFile: ts.readConfigFile,
  sys: ts.sys,
};
