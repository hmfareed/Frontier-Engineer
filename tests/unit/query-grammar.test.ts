import { describe, it, expect } from "vitest";
import { QueryGrammar } from "../../scripts/query/query-grammar.ts";

describe("query-grammar (Deterministic Natural Query Parser)", () => {
  it("parses overview queries", () => {
    expect(QueryGrammar.parse("what does this repository contain?").category).toBe("overview");
    expect(QueryGrammar.parse("overview").category).toBe("overview");
    expect(QueryGrammar.parse("summarize architecture").category).toBe("overview");
  });

  it("parses status queries", () => {
    expect(QueryGrammar.parse("status").category).toBe("status");
    expect(QueryGrammar.parse("what is the status of the index?").category).toBe("status");
    expect(QueryGrammar.parse("is index fresh").category).toBe("status");
  });

  it("parses components queries and single component inspection", () => {
    expect(QueryGrammar.parse("what are the architectural components?").category).toBe(
      "components",
    );
    expect(QueryGrammar.parse("components").category).toBe("components");

    const compIntent = QueryGrammar.parse("inspect component frontend");
    expect(compIntent.category).toBe("component");
    expect(compIntent.target).toBe("frontend");

    const authIntent = QueryGrammar.parse("which files are responsible for authentication?");
    expect(authIntent.category).toBe("component");
    expect(authIntent.target).toBe("auth");

    const dbIntent = QueryGrammar.parse("where is database?");
    expect(dbIntent.category).toBe("component");
    expect(dbIntent.target).toBe("database");
  });

  it("parses entrypoints queries", () => {
    expect(QueryGrammar.parse("what are the application entry points?").category).toBe(
      "entrypoints",
    );
    expect(QueryGrammar.parse("entrypoints").category).toBe("entrypoints");
    expect(QueryGrammar.parse("find entrypoints").category).toBe("entrypoints");
  });

  it("parses dependencies and dependents queries", () => {
    const depIntent = QueryGrammar.parse("what does src/index.ts depend on?");
    expect(depIntent.category).toBe("dependencies");
    expect(depIntent.target).toBe("src/index.ts");

    const depDirect = QueryGrammar.parse("dependencies src/components/Button.tsx");
    expect(depDirect.category).toBe("dependencies");
    expect(depDirect.target).toBe("src/components/Button.tsx");

    const dependentsIntent = QueryGrammar.parse("what depends on src/utils.ts?");
    expect(dependentsIntent.category).toBe("dependents");
    expect(dependentsIntent.target).toBe("src/utils.ts");

    const dependentsDirect = QueryGrammar.parse("dependents of express");
    expect(dependentsDirect.category).toBe("dependents");
    expect(dependentsDirect.target).toBe("express");
  });

  it("parses circular dependency cycle queries", () => {
    expect(QueryGrammar.parse("are there circular dependencies?").category).toBe("cycles");
    expect(QueryGrammar.parse("cycles").category).toBe("cycles");
    expect(QueryGrammar.parse("show cycles").category).toBe("cycles");
  });

  it("parses tests queries", () => {
    expect(QueryGrammar.parse("tests").category).toBe("tests");
    expect(QueryGrammar.parse("which tests cover src/server.ts?").category).toBe("tests");
    expect(QueryGrammar.parse("which tests cover src/server.ts?").target).toBe("src/server.ts");
  });

  it("parses decisions (ADR) queries", () => {
    expect(QueryGrammar.parse("what architectural decisions are documented?").category).toBe(
      "decisions",
    );
    expect(QueryGrammar.parse("decisions").category).toBe("decisions");

    const singleAdr = QueryGrammar.parse("inspect decision ADR-007");
    expect(singleAdr.category).toBe("decision");
    expect(singleAdr.target).toBe("ADR-007");
  });

  it("parses file and symbol queries", () => {
    const fileIntent = QueryGrammar.parse("inspect file src/index.ts");
    expect(fileIntent.category).toBe("file");
    expect(fileIntent.target).toBe("src/index.ts");

    const symIntent = QueryGrammar.parse("find symbol User");
    expect(symIntent.category).toBe("symbol");
    expect(symIntent.target).toBe("User");
  });

  it("rejects unsupported queries with helpful guidance", () => {
    expect(() => QueryGrammar.parse("how do I deploy this to kubernetes?")).toThrowError(
      /Unsupported query pattern/i,
    );
    expect(() => QueryGrammar.parse("")).toThrowError(/cannot be empty/i);
  });
});
