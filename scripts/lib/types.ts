export type Severity = "error" | "warning" | "note";

export interface Finding {
  severity: Severity;
  rule: string;
  file: string;
  message: string;
}

export interface CheckResult {
  name: string;
  findings: Finding[];
}

export interface JsonParseOutcome {
  ok: boolean;
  value: unknown;
  finding?: Finding;
}
