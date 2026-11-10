import { exists, isExcluded, readText, walkFiles } from "./walk.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";

const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** Foundation-level secret hygiene. This is not a substitute for a dedicated secret scanner. */
export function checkSecretHygiene(root: string): Finding[] {
  const findings: Finding[] = [];

  const envFiles = walkFiles(
    root,
    (rel) => !isExcluded(rel) && /\.env(\..+)?$/.test(rel) && !rel.endsWith(".env.example"),
  );
  for (const rel of envFiles) {
    findings.push(
      finding(
        "error",
        "env-file-present",
        rel,
        "Environment files must not be committed. Remove this file and document required variables in SECURITY.md instead.",
      ),
    );
  }

  if (exists(root, "mcp_config.json")) {
    const config = readText(root, "mcp_config.json");
    if (config && /Bearer\s+(?!\$\{|YOUR_|REPLACE_|<)[A-Za-z0-9._-]{12,}/.test(config)) {
      findings.push(
        finding(
          "error",
          "literal-bearer-token",
          "mcp_config.json",
          "A literal bearer token appears in MCP config. Use a ${VARIABLE} placeholder declared under variables.",
        ),
      );
    }
  }

  const textFiles = walkFiles(
    root,
    (rel) => !isExcluded(rel) && /\.(md|json|ts|ya?ml|svg|txt)$/.test(rel),
  );
  for (const rel of textFiles) {
    const text = readText(root, rel);
    if (text && PEM_PRIVATE_KEY.test(text)) {
      findings.push(
        finding(
          "error",
          "private-key-material",
          rel,
          "PEM private key material detected. Remove it.",
        ),
      );
    }
  }

  return findings;
}
