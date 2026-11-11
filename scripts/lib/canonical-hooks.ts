import fs from "node:fs";
import path from "node:path";
import { validateValueAgainstSchema } from "./json-config.ts";
import { finding } from "./report.ts";
import type { Finding } from "./types.ts";
import { exists, readText } from "./walk.ts";
import { parseFrontmatter } from "./yaml-frontmatter.ts";

export const HOOK_IDS = [
  "frontier-session-init",
  "frontier-pre-tool-safety",
  "frontier-post-tool-audit",
  "frontier-engineering-context",
  "frontier-invocation-audit",
  "frontier-session-stop",
] as const;

export type HookId = (typeof HOOK_IDS)[number];

export const HOOK_FILE_MAP: Record<HookId, string> = {
  "frontier-session-init": "specs/hooks/session-start.md",
  "frontier-pre-tool-safety": "specs/hooks/pre-tool-use.md",
  "frontier-post-tool-audit": "specs/hooks/post-tool-use.md",
  "frontier-engineering-context": "specs/hooks/pre-invocation.md",
  "frontier-invocation-audit": "specs/hooks/post-invocation.md",
  "frontier-session-stop": "specs/hooks/stop.md",
};

export const LIFECYCLE_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "PreInvocation",
  "PostInvocation",
  "Stop",
] as const;

export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

export const REQUIRED_HOOK_SECTIONS = [
  "Purpose and overview",
  "Lifecycle event and matcher",
  "Handler command and execution",
  "Input and output contracts",
  "Security boundaries and failure behavior",
  "Logging, diagnostics, and privacy",
  "Cross-platform portability and compatibility",
] as const;

export const CANONICAL_HOOK_SCHEMA = "schemas/canonical-hook.schema.json";
export const HOOK_REGISTRY_SCHEMA = "schemas/hook-registry.schema.json";
export const HOOK_EVALUATION_SCHEMA = "schemas/hook-evaluation-scenarios.schema.json";

export interface CanonicalHookSpec {
  relPath: string;
  id: HookId;
  name: string;
  description: string;
  event: LifecycleEvent;
  matcher?: string;
  handler: {
    type: "command";
    command: string;
    timeout: number;
  };
  securityClassification:
    "critical_security" | "audit_logging" | "context_injection" | "session_lifecycle";
  failureMode: "fail_closed" | "fail_open" | "degrade_gracefully";
  enabled: boolean;
  platformConfig: Record<string, unknown>;
  body: string;
}

export interface HookRegistryEntry {
  id: HookId;
  name: string;
  event: LifecycleEvent;
  matcher?: string;
  securityClassification: string;
  failureMode: string;
  enabled: boolean;
  specPath: string;
  handlerPath: string;
  compatibility: {
    antigravity: string;
    claude_code?: string;
    cursor?: string;
    codex?: string;
  };
}

export function loadHookRegistry(root: string): {
  registry: { version: string; lastUpdated: string; hooks: HookRegistryEntry[] } | null;
  findings: Finding[];
} {
  const rel = path.join("specs", "hooks", "hook-registry.md");
  if (!exists(root, rel)) {
    return {
      registry: null,
      findings: [
        finding("error", "missing-hook-registry", rel, "Canonical hook registry does not exist."),
      ],
    };
  }

  const raw = readText(root, rel);
  if (raw === null) {
    return {
      registry: null,
      findings: [
        finding("error", "unreadable-hook-registry", rel, "Could not read hook registry."),
      ],
    };
  }
  const parsed = parseFrontmatter(raw);
  if (!parsed.present) {
    return {
      registry: null,
      findings: [
        finding(
          "error",
          "missing-registry-frontmatter",
          rel,
          "Hook registry must contain YAML frontmatter.",
        ),
      ],
    };
  }

  const findings = validateValueAgainstSchema(
    root,
    parsed.data,
    rel,
    HOOK_REGISTRY_SCHEMA,
    "invalid-hook-registry",
  );

  return {
    registry: parsed.data as {
      version: string;
      lastUpdated: string;
      hooks: HookRegistryEntry[];
    },
    findings,
  };
}

export function loadCanonicalHookSpecs(root: string): {
  specs: CanonicalHookSpec[];
  findings: Finding[];
} {
  const findings: Finding[] = [];
  const specs: CanonicalHookSpec[] = [];
  const hooksDir = path.join(root, "specs", "hooks");

  if (!fs.existsSync(hooksDir)) {
    findings.push(
      finding(
        "error",
        "missing-hooks-specs-dir",
        "specs/hooks",
        "Canonical hooks specification directory specs/hooks does not exist.",
      ),
    );
    return { specs, findings };
  }

  const entries = fs.readdirSync(hooksDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (
      entry.name === "README.md" ||
      entry.name === "hook-registry.md" ||
      entry.name === "hook-security-model.md"
    ) {
      continue;
    }

    const relPath = path.join("specs", "hooks", entry.name).replace(/\\/g, "/");
    const raw = readText(root, relPath);
    if (raw === null) {
      findings.push(
        finding("error", "unreadable-canonical-hook", relPath, "Could not read hook spec."),
      );
      continue;
    }
    const parsed = parseFrontmatter(raw);

    if (!parsed.present) {
      findings.push(
        finding(
          "error",
          "missing-hook-frontmatter",
          relPath,
          "Canonical hook specification must contain YAML frontmatter.",
        ),
      );
      continue;
    }

    const schemaFindings = validateValueAgainstSchema(
      root,
      parsed.data,
      relPath,
      CANONICAL_HOOK_SCHEMA,
      "invalid-canonical-hook",
    );
    findings.push(...schemaFindings);

    const data = parsed.data as Record<string, unknown>;
    const id = data.id as HookId;
    const event = data.event as LifecycleEvent;
    const handler = data.handler as { type: "command"; command: string; timeout: number };

    specs.push({
      relPath,
      id,
      name: data.name as string,
      description: data.description as string,
      event,
      matcher: data.matcher as string | undefined,
      handler,
      securityClassification:
        data.securityClassification as CanonicalHookSpec["securityClassification"],
      failureMode: data.failureMode as CanonicalHookSpec["failureMode"],
      enabled: Boolean(data.enabled),
      platformConfig: (data.platformConfig as Record<string, unknown>) ?? {},
      body: parsed.body,
    });
  }

  return { specs, findings };
}

export function validateCanonicalHooks(root: string): Finding[] {
  const findings: Finding[] = [];

  const { registry, findings: regFindings } = loadHookRegistry(root);
  findings.push(...regFindings);

  const { specs, findings: specFindings } = loadCanonicalHookSpecs(root);
  findings.push(...specFindings);

  if (specs.length !== HOOK_IDS.length) {
    findings.push(
      finding(
        "error",
        "hook-count-mismatch",
        "specs/hooks",
        `Expected ${HOOK_IDS.length} canonical hooks, found ${specs.length}.`,
      ),
    );
  }

  const specIds = new Set(specs.map((s) => s.id));
  for (const expectedId of HOOK_IDS) {
    if (!specIds.has(expectedId)) {
      findings.push(
        finding(
          "error",
          "missing-canonical-hook-spec",
          HOOK_FILE_MAP[expectedId] ?? `specs/hooks/${expectedId}.md`,
          `Missing canonical specification for hook ${expectedId}.`,
        ),
      );
    }
  }

  for (const spec of specs) {
    for (const section of REQUIRED_HOOK_SECTIONS) {
      const pattern = new RegExp(`^## ${section}\\s*$`, "m");
      if (!pattern.test(spec.body)) {
        findings.push(
          finding(
            "error",
            "missing-hook-section",
            spec.relPath,
            `Canonical hook ${spec.id} is missing required section: "${section}".`,
          ),
        );
      }
    }

    if (spec.event === "PreToolUse" || spec.event === "PostToolUse") {
      if (!spec.matcher || spec.matcher.trim() === "") {
        findings.push(
          finding(
            "error",
            "missing-tool-matcher",
            spec.relPath,
            `Tool event ${spec.event} requires a non-empty matcher configuration.`,
          ),
        );
      }
    }
  }

  if (registry) {
    const regIds = new Set(registry.hooks.map((h) => h.id));
    for (const spec of specs) {
      if (!regIds.has(spec.id)) {
        findings.push(
          finding(
            "error",
            "hook-not-registered",
            "specs/hooks/hook-registry.md",
            `Canonical hook ${spec.id} is not listed in hook registry.`,
          ),
        );
      }
    }
  }

  return findings;
}

export function buildAntigravityHooksConfig(root: string): string {
  const { specs } = loadCanonicalHookSpecs(root);

  const configObj: Record<string, Record<string, unknown>> = {};

  // Sort specs deterministically by HOOK_IDS order
  const orderMap = new Map<string, number>(HOOK_IDS.map((id, index) => [id, index]));
  const sortedSpecs = [...specs].sort(
    (a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99),
  );

  for (const spec of sortedSpecs) {
    const hookConfig: Record<string, unknown> = {
      enabled: spec.enabled,
    };

    const handler = {
      type: spec.handler.type,
      command: spec.handler.command,
      timeout: spec.handler.timeout,
    };

    if (spec.event === "PreToolUse" || spec.event === "PostToolUse") {
      hookConfig[spec.event] = [
        {
          matcher: spec.matcher ?? "*",
          hooks: [handler],
        },
      ];
    } else {
      hookConfig[spec.event] = [handler];
    }

    configObj[spec.id] = hookConfig;
  }

  return JSON.stringify(configObj, null, 2) + "\n";
}

export function checkGeneratedHooks(root: string): Finding[] {
  const findings: Finding[] = [];
  const hooksPath = path.join(root, "hooks.json");

  if (!fs.existsSync(hooksPath)) {
    findings.push(
      finding(
        "error",
        "missing-generated-hooks-json",
        "hooks.json",
        "Antigravity hooks configuration hooks.json is missing.",
      ),
    );
    return findings;
  }

  const currentContent = fs.readFileSync(hooksPath, "utf8");
  const expectedContent = buildAntigravityHooksConfig(root);

  if (currentContent !== expectedContent) {
    findings.push(
      finding(
        "error",
        "stale-generated-hooks-json",
        "hooks.json",
        "hooks.json is out of date with canonical specifications. Run 'npm run generate:hooks'.",
      ),
    );
  }

  return findings;
}
