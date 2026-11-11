import { describe, expect, it } from "vitest";
import { classifyFile } from "../../scripts/scanner/file-classifier.ts";

describe("file-classifier", () => {
  it("classifies programming language source files as 'source'", () => {
    expect(classifyFile("src/index.ts")).toBe("source");
    expect(classifyFile("src/App.tsx")).toBe("source");
    expect(classifyFile("lib/utils.js")).toBe("source");
    expect(classifyFile("components/Button.jsx")).toBe("source");
    expect(classifyFile("server.py")).toBe("source");
    expect(classifyFile("main.go")).toBe("source");
    expect(classifyFile("src/lib.rs")).toBe("source");
    expect(classifyFile("Main.java")).toBe("source");
    expect(classifyFile("core.c")).toBe("source");
    expect(classifyFile("engine.cpp")).toBe("source");
  });

  it("classifies documentation files as 'documentation'", () => {
    expect(classifyFile("README.md")).toBe("documentation");
    expect(classifyFile("docs/guide.markdown")).toBe("documentation");
    expect(classifyFile("CHANGELOG.txt")).toBe("documentation");
    expect(classifyFile("manual.rst")).toBe("documentation");
    expect(classifyFile("spec.adoc")).toBe("documentation");
  });

  it("classifies configuration and schema files as 'configuration'", () => {
    expect(classifyFile("package.json")).toBe("configuration");
    expect(classifyFile("config.yaml")).toBe("configuration");
    expect(classifyFile("settings.yml")).toBe("configuration");
    expect(classifyFile("Cargo.toml")).toBe("configuration");
    expect(classifyFile("tsconfig.json")).toBe("configuration");
    expect(classifyFile(".prettierrc.json")).toBe("configuration");
  });

  it("classifies web and creative assets as 'asset'", () => {
    expect(classifyFile("assets/logo.svg")).toBe("asset");
    expect(classifyFile("images/banner.png")).toBe("asset");
    expect(classifyFile("photo.jpg")).toBe("asset");
    expect(classifyFile("photo.webp")).toBe("asset");
    expect(classifyFile("styles/global.css")).toBe("asset");
    expect(classifyFile("theme.scss")).toBe("asset");
    expect(classifyFile("index.html")).toBe("asset");
  });

  it("classifies binary and database files as 'binary'", () => {
    expect(classifyFile("app.wasm")).toBe("binary");
    expect(classifyFile("bundle.zip")).toBe("binary");
    expect(classifyFile("archive.tar.gz")).toBe("binary");
    expect(classifyFile("report.pdf")).toBe("binary");
    expect(classifyFile("program.exe")).toBe("binary");
    expect(classifyFile("library.dll")).toBe("binary");
    expect(classifyFile("data.sqlite")).toBe("binary");
    expect(classifyFile("data.db")).toBe("binary");
  });

  it("classifies sensitive credentials as 'sensitive'", () => {
    expect(classifyFile(".env")).toBe("sensitive");
    expect(classifyFile(".env.local")).toBe("sensitive");
    expect(classifyFile("id_rsa")).toBe("sensitive");
    expect(classifyFile("server.pem")).toBe("sensitive");
  });
});
